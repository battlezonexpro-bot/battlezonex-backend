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
const PAY0_TOKEN    = process.env.PAY0_API_KEY;
const BACKEND_URL   = process.env.BACKEND_URL || "https://battlezonex-backend.onrender.com";

/* ─────────────────────────────────────────────
   HOME
───────────────────────────────────────────── */
app.get("/", (req, res) => res.send("🚀 BattleZoneX Backend Running"));

/* ─────────────────────────────────────────────
   CREATE ORDER
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
      return res.json({ status: false, message: response.data?.message || "Gateway Error" });
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
   BULLETPROOF WEBHOOK (POST & GET)
───────────────────────────────────────────── */
app.all("/webhook", async (req, res) => {
  const isGet = req.method === "GET";
  const data = isGet ? req.query : req.body;
  
  console.log(`Webhook [${req.method}]:`, data);

  try {
    // Pay0 alag-alag parameters bhejta hai POST aur GET mein
    const order_id = data.order_id || data.client_txn_id;

    if (!order_id) {
      if (isGet) return res.send(`<html><meta http-equiv="refresh" content="0;url=battlezonex://payment?status=failed&reason=invalid_data"></html>`);
      return res.send("OK");
    }

    if (!db) {
      console.error("DB not initialized");
      return res.status(500).send("DB error");
    }

    const orderRef = db.collection("PendingOrders").doc(order_id);
    const orderDoc = await orderRef.get();

    // Order database mein na mile
    if (!orderDoc.exists) {
      if (isGet) return res.send(`<html><meta http-equiv="refresh" content="0;url=battlezonex://payment?status=failed&reason=order_not_found"></html>`);
      return res.send("OK");
    }

    const orderData = orderDoc.data();

    // 1. Agar pehle se credit ho chuka hai, bas safely user ko app me bhejo
    if (orderData.status === "CREDITED") {
      if (isGet) return res.send(`<html><meta http-equiv="refresh" content="0;url=battlezonex://payment?status=success&order_id=${order_id}"></html>`);
      return res.send("OK");
    }

    // 2. Proactive API Check: Hum Payload pe depend nahi rahenge, direct Pay0 se poochenge
    const checkRes = await axios.post(
      "https://pay0.shop/api/check-order-status",
      qs.stringify({ user_token: PAY0_TOKEN, order_id }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    console.log(`Pay0 Real Verification for ${order_id}:`, checkRes.data);

    const realStatus = checkRes.data.status; // Asli status from server

    // 3. Agar Asli status Success hai, Firebase ko Atomic update karo
    if (realStatus === "SUCCESS" || realStatus === true) {
      const uid = orderData.uid;
      const amount = Number(orderData.amount);
      const userRef = db.collection("Users").doc(uid);

      await db.runTransaction(async (t) => {
        const userDoc = await t.get(userRef);
        const current = userDoc.exists ? (userDoc.data().depositBalance || 0) : 0;

        // Balance aur PendingOrders dono ek sath update
        t.set(userRef, { depositBalance: current + amount }, { merge: true });
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

      console.log(`✅ ₹${amount} Safely Credited to User: ${uid}`);

      // Transaction poori hone ke baad app mein redirect karo
      if (isGet) return res.send(`<html><meta http-equiv="refresh" content="0;url=battlezonex://payment?status=success&order_id=${order_id}"></html>`);
      return res.send("OK");

    } else {
      // Payment Failed ya Pending
      if (isGet) return res.send(`<html><meta http-equiv="refresh" content="0;url=battlezonex://payment?status=failed&reason=not_paid"></html>`);
      return res.send("OK");
    }

  } catch (err) {
    console.error("Robust Webhook error:", err.message);
    if (isGet) return res.send(`<html><meta http-equiv="refresh" content="0;url=battlezonex://payment?status=failed&reason=server_error"></html>`);
    res.status(500).send("Error");
  }
});

/* ─────────────────────────────────────────────
   START
───────────────────────────────────────────── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
