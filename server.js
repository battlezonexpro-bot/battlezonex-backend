const express = require("express");
const cors    = require("cors");
const admin   = require("firebase-admin");
const axios   = require("axios");
const qs      = require("querystring");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ─────────────────────────────────────────────
   FIREBASE INIT
───────────────────────────────────────────── */
let db = null;
try {
  if (process.env.FIREBASE_CONFIG) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_CONFIG))
    });
    db = admin.firestore();
    console.log("🔥 Firebase Connected");
  } else {
    console.log("❌ FIREBASE_CONFIG missing");
  }
} catch (err) {
  console.log("Firebase Error:", err.message);
}

/* ─────────────────────────────────────────────
   KEYS
───────────────────────────────────────────── */
const PAY0_TOKEN    = process.env.PAY0_API_KEY;   // Pay0 user_token
const BACKEND_URL   = process.env.BACKEND_URL || "https://battlezonex-backend.onrender.com";

/* ─────────────────────────────────────────────
   HOME
───────────────────────────────────────────── */
app.get("/", (req, res) => res.send("🚀 BattleZoneX Backend Running"));

/* ─────────────────────────────────────────────
   CREATE ORDER  ← Android calls this
───────────────────────────────────────────── */
app.post("/create-order", async (req, res) => {
  try {
    const { uid, customer_mobile, customer_name, amount } = req.body;

    if (!uid || !amount || !customer_mobile) {
      return res.status(400).json({ status: false, message: "Missing fields" });
    }

    const order_id = `BZX_${uid.slice(0, 8)}_${Date.now()}`;

    const payload = {
      customer_mobile,
      customer_name:  customer_name || "Player",
      user_token:     PAY0_TOKEN,
      amount:         String(amount),
      order_id,
      redirect_url:   `${BACKEND_URL}/webhook`,
      remark1:        uid,          
      remark2:        "BattleZoneX"
    };

    const response = await axios.post(
      "https://pay0.shop/api/create-order",
      qs.stringify(payload),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    console.log("📦 Raw Pay0 Response:", response.data); // LOG: Debugging ke liye zaroori hai

    // ✅ FIXED: Check both root level and inside 'result' object for the payment URL
    const payUrl = response.data.payment_url || (response.data.result && response.data.result.payment_url);

    if (response.data && (response.data.status === true || response.data.status === "SUCCESS") && payUrl) {
      
      await db.collection("PendingOrders").doc(order_id).set({
        order_id,
        uid,
        amount: Number(amount),
        status: "PENDING",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.json({
        status:      true,
        payment_url: payUrl,
        order_id
      });
    } else {
      return res.json({ 
        status: false, 
        message: response.data?.message || "Payment URL missing from Pay0 response" 
      });
    }

  } catch (err) {
    console.error("create-order error:", err.message);
    res.status(500).json({ status: false, message: "Server Error" });
  }
});

/* ─────────────────────────────────────────────
   CHECK ORDER STATUS
───────────────────────────────────────────── */
app.post("/check-order-status", async (req, res) => {
  try {
    const { order_id } = req.body;
    if (!order_id) return res.status(400).json({ status: false, message: "order_id required" });

    const response = await axios.post(
      "https://pay0.shop/api/check-order-status",
      qs.stringify({ user_token: PAY0_TOKEN, order_id }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    res.json(response.data);
  } catch (err) {
    console.error("check-order-status error:", err.message);
    res.status(500).json({ status: false, message: "Server Error" });
  }
});

/* ─────────────────────────────────────────────
   WEBHOOK
───────────────────────────────────────────── */
app.all("/webhook", async (req, res) => {
  const data = req.method === "GET" ? req.query : req.body;
  console.log(`Webhook [${req.method}]:`, data);

  try {
    const status   = data.status;
    const uid      = data.remark1;
    const order_id = data.order_id;
    const amount   = Number(data.amount);

    if (status === "SUCCESS" && uid && order_id && amount) {

      if (!db) {
        console.error("DB not initialized");
        return res.status(500).send("DB error");
      }

      const orderRef = db.collection("PendingOrders").doc(order_id);
      const orderDoc = await orderRef.get();

      if (orderDoc.exists && orderDoc.data().status === "CREDITED") {
        console.log(`Duplicate webhook ignored: ${order_id}`);
        return req.method === "GET"
          ? res.send("<h1>Payment already processed!</h1>")
          : res.send("OK");
      }

      const userRef = db.collection("Users").doc(uid); 

      await db.runTransaction(async (t) => {
        const userDoc = await t.get(userRef);

        if (!userDoc.exists) {
          t.set(userRef, { depositBalance: amount });
        } else {
          const current = userDoc.data().depositBalance || 0;
          t.update(userRef, { depositBalance: current + amount });
        }

        t.update(orderRef, {
          status:    "CREDITED",
          creditedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const depositRef = db.collection("Deposits").doc(order_id);
        t.set(depositRef, {
          depositId:  order_id,
          orderId:    order_id,
          userId:     uid,
          amount,
          status:     "Confirmed",
          gateway:    "Pay0",
          timestamp:  Date.now()
        });
      });

      console.log(`✅ ₹${amount} credited to User: ${uid}`);
    }

    if (req.method === "GET") {
      res.send(`
        <html>
          <head>
            <meta http-equiv="refresh" content="2;url=battlezonex://payment?status=success&order_id=${order_id || ''}">
          </head>
          <body style="font-family:sans-serif;text-align:center;padding:40px">
            <h2>✅ Payment Successful!</h2>
            <p>Redirecting back to app...</p>
            <p><a href="battlezonex://payment?status=success&order_id=${order_id || ''}">Tap here if not redirected</a></p>
          </body>
        </html>
      `);
    } else {
      res.send("OK");
    }

  } catch (err) {
    console.error("Webhook error:", err.message);
    res.status(500).send("Error");
  }
});

/* ─────────────────────────────────────────────
   START
───────────────────────────────────────────── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
