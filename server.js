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
    console.log("❌ FIREBASE_CONFIG missing in environment variables.");
  }
} catch (err) {
  console.log("Firebase Error:", err.message);
}

/* ─────────────────────────────────────────────
   KEYS & URLS
───────────────────────────────────────────── */
const PAY0_TOKEN    = process.env.PAY0_API_KEY;
const BACKEND_URL   = process.env.BACKEND_URL || "https://battlezonex-backend.onrender.com";

/* ─────────────────────────────────────────────
   HELPER: WebView Redirect HTML
   (Android WebView me redirect successfully execute karwane ke liye)
───────────────────────────────────────────── */
const sendAppRedirect = (res, status, order_id = "", reason = "") => {
  const deepLink = `battlezonex://payment?status=${status}&order_id=${order_id}&reason=${reason}`;
  res.send(`
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: sans-serif; text-align: center; margin-top: 40px; background: #f9f9f9; }
          .loader { border: 4px solid #f3f3f3; border-top: 4px solid #00695C; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 20px auto; }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        </style>
      </head>
      <body>
        <h3>Processing Payment...</h3>
        <p>Please wait, taking you back to the app.</p>
        <div class="loader"></div>
        <script>
          // Deep Link Redirect Script
          setTimeout(function() {
            window.location.href = "${deepLink}";
          }, 500);
        </script>
      </body>
    </html>
  `);
};

/* ─────────────────────────────────────────────
   HOME API
───────────────────────────────────────────── */
app.get("/", (req, res) => res.send("🚀 BattleZoneX Backend Running"));

/* ─────────────────────────────────────────────
   CREATE ORDER (App se call hoga)
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
      // URL me order_id pass kar rahe hain taaki GET webhook usko read kar sake
      redirect_url:   `${BACKEND_URL}/webhook?order_id=${order_id}`, 
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
      
      // Order ko PendingOrders me save karo
      await db.collection("PendingOrders").doc(order_id).set({
        order_id,
        uid,
        amount: Number(amount),
        status: "PENDING",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.json({ status: true, payment_url: payUrl, order_id });
    } else {
      return res.json({ status: false, message: response.data?.message || "Gateway Error" });
    }
  } catch (err) {
    console.error("create-order error:", err.message);
    res.status(500).json({ status: false, message: "Server Error" });
  }
});

/* ─────────────────────────────────────────────
   CHECK ORDER STATUS API
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
  
  console.log(`Webhook [${req.method}]:`, JSON.stringify(data));

  try {
    const order_id = data.order_id || data.client_txn_id || data.txn_id;

    if (!order_id) {
      console.log("❌ Webhook me order_id nahi mili.");
      if (isGet) return sendAppRedirect(res, "failed", "", "invalid_data");
      return res.send("OK");
    }

    if (!db) return res.status(500).send("DB error");

    // GET request (User app me wapas aa raha hai) ke liye 4 sec wait
    if (isGet) {
      console.log(`⏳ Waiting 4s for order ${order_id} to prevent race condition...`);
      await new Promise(resolve => setTimeout(resolve, 4000));
    }

    const orderRef = db.collection("PendingOrders").doc(order_id);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      console.log(`❌ Order ${order_id} DB mein nahi mila.`);
      if (isGet) return sendAppRedirect(res, "failed", order_id, "order_not_found");
      return res.send("OK");
    }

    const orderData = orderDoc.data();

    // Agar pehle hi CREDITED ho chuka hai (via POST webhook)
    if (orderData.status === "CREDITED") {
      if (isGet) return sendAppRedirect(res, "success", order_id, "");
      return res.send("OK");
    }

    // Pay0 API se status verify karo
    const checkRes = await axios.post(
      "https://pay0.shop/api/check-order-status",
      qs.stringify({ user_token: PAY0_TOKEN, order_id }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    console.log(`🔍 Pay0 API Verification for ${order_id}:`, JSON.stringify(checkRes.data));

    const apiData = checkRes.data || {};
    let isSuccess = false;

    // 🔥 MAIN FIX: Check BOTH 'txnStatus' and 'status' from API response
    const mainStatus = String(apiData.status).toUpperCase();
    
    let nestedStatus = "";
    if (apiData.result) {
        nestedStatus = String(apiData.result.txnStatus || apiData.result.status || "").toUpperCase();
    } else if (apiData.data) {
        nestedStatus = String(apiData.data.txnStatus || apiData.data.status || "").toUpperCase();
    }

    if (apiData.status === true || mainStatus === "SUCCESS") {
        if (nestedStatus === "SUCCESS" || nestedStatus === "COMPLETED") {
            isSuccess = true;
        } else if (!apiData.result && !apiData.data) {
            isSuccess = true; // Agar nested object nahi hai, but main status true hai
        }
    }

    // Agar payment verified ho gayi
    if (isSuccess) {
      const uid = orderData.uid;
      const amount = Number(orderData.amount);
      const userRef = db.collection("Users").doc(uid);

      await db.runTransaction(async (t) => {
        const userDoc = await t.get(userRef);
        const current = userDoc.exists ? (userDoc.data().depositBalance || 0) : 0;

        // Balance Update
        t.set(userRef, { depositBalance: current + amount }, { merge: true });
        
        // Mark Order as Credited
        t.update(orderRef, {
          status: "CREDITED",
          creditedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Add to Deposits Collection for History
        const depositRef = db.collection("Deposits").doc(order_id);
        t.set(depositRef, {
          depositId: order_id,
          orderId: order_id,
          userId: uid,
          amount,
          status: "Confirmed",
          gateway: "Pay0",
          timestamp: Date.now()
        });
      });

      console.log(`✅ ₹${amount} Safely Credited to User: ${uid}`);

      if (isGet) return sendAppRedirect(res, "success", order_id, "");
      return res.send("OK");

    } else {
      console.log(`⏳ Payment PENDING or FAILED for ${order_id}.`);
      if (isGet) return sendAppRedirect(res, "failed", order_id, "payment_incomplete");
      return res.send("OK");
    }

  } catch (err) {
    console.error("Robust Webhook error:", err.message);
    if (isGet) return sendAppRedirect(res, "failed", "", "server_error");
    res.status(500).send("Error");
  }
});

/* ─────────────────────────────────────────────
   START SERVER
───────────────────────────────────────────── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
