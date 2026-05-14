require("dotenv").config(); // FIXED: Changed 'Require' to 'require'
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const axios = require("axios");
const qs = require("querystring");

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
      credential: admin.credential.cert(
        JSON.parse(process.env.FIREBASE_CONFIG)
      )
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
   ENV VARIABLES
───────────────────────────────────────────── */
const PAY0_TOKEN = process.env.PAY0_API_KEY;

const BACKEND_URL =
  process.env.BACKEND_URL ||
  "https://battlezonex-backend.onrender.com";

const ONE_SIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONE_SIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;

/* ─────────────────────────────────────────────
   ONESIGNAL NOTIFICATION FUNCTION
───────────────────────────────────────────── */
async function sendNotification(title, message, uids = null, exclude_uids = null) {
  try {
    let payload = {
      app_id: ONE_SIGNAL_APP_ID,
      headings: { en: title },
      contents: { en: message }
    };

    if (uids && uids.length > 0) {
      payload.include_aliases = { external_id: uids };
      payload.target_channel = "push";
    } else {
      payload.included_segments = ["Total Subscriptions"];

      if (exclude_uids && exclude_uids.length > 0) {
        payload.target_channel = "push";
        payload.exclude_aliases = { external_id: exclude_uids };
      }
    }

    await axios.post(
      "https://api.onesignal.com/notifications",
      payload,
      {
        headers: {
          Authorization: `Basic ${ONE_SIGNAL_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("✅ Notification Sent");
  } catch (err) {
    console.log(
      "❌ Notification Error:",
      err.response?.data || err.message
    );
  }
}

/* ─────────────────────────────────────────────
   APP REDIRECT HTML
───────────────────────────────────────────── */
const sendAppRedirect = (res, status, order_id = "", reason = "") => {
  const deepLink = `battlezonex://payment?status=${status}&order_id=${order_id}&reason=${reason}`;

  res.send(`
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body {
            font-family: sans-serif;
            text-align: center;
            margin-top: 40px;
            background: #f9f9f9;
          }

          .loader {
            border: 4px solid #f3f3f3;
            border-top: 4px solid #00695C;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 20px auto;
          }

          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </head>

      <body>
        <h3>Processing Payment...</h3>
        <p>Please wait...</p>

        <div class="loader"></div>

        <script>
          setTimeout(function() {
            window.location.href = "${deepLink}";
          }, 500);
        </script>
      </body>
    </html>
  `);
};

/* ─────────────────────────────────────────────
   HOME
───────────────────────────────────────────── */
app.get("/", (req, res) => {
  res.send("🚀 BattleZoneX Backend Running");
});

/* ─────────────────────────────────────────────
   MANUAL NOTIFICATION API (FIXED FOR ARRAYS & APP)
───────────────────────────────────────────── */
app.all("/send-notification", async (req, res) => {
  try {
    const title = req.query.title || req.body.title;
    const message = req.query.message || req.body.message;
    let uids = req.query.uids || req.body.uids;
    let exclude_uids = req.query.exclude_uids || req.body.exclude_uids;

    if (!title || !message) {
      return res.status(400).json({
        status: false,
        message: "Missing title/message."
      });
    }

    let parsedUids = [];
    let parsedExcludeUids = [];

    if (uids) {
      if (typeof uids === 'string') {
        try { parsedUids = JSON.parse(uids); }
        catch (e) { parsedUids = [uids]; }
      } else if (Array.isArray(uids)) {
        parsedUids = uids;
      }
    }

    if (exclude_uids) {
      if (typeof exclude_uids === 'string') {
        try { parsedExcludeUids = JSON.parse(exclude_uids); }
        catch (e) { parsedExcludeUids = [exclude_uids]; }
      } else if (Array.isArray(exclude_uids)) {
        parsedExcludeUids = exclude_uids;
      }
    }

    await sendNotification(
      title,
      message,
      parsedUids.length > 0 ? parsedUids : null,
      parsedExcludeUids.length > 0 ? parsedExcludeUids : null
    );

    res.json({
      status: true,
      message: "Notification Sent"
    });

  } catch (err) {
    console.log(err.message);

    res.status(500).json({
      status: false,
      message: "Server Error"
    });
  }
});

/* ─────────────────────────────────────────────
   CREATE ORDER
───────────────────────────────────────────── */
app.post("/create-order", async (req, res) => {
  try {
    const { uid, customer_mobile, customer_name, amount } = req.body;

    if (!uid || !amount || !customer_mobile) {
      return res.status(400).json({
        status: false,
        message: "Missing fields"
      });
    }

    const order_id = `BZX_${uid.slice(0, 8)}_${Date.now()}`;

    const payload = {
      customer_mobile,
      customer_name: customer_name || "Player",
      user_token: PAY0_TOKEN,
      amount: String(amount),
      order_id,
      redirect_url: `${BACKEND_URL}/webhook?order_id=${order_id}`,
      remark1: uid,
      remark2: "BattleZoneX"
    };

    const response = await axios.post(
      "https://pay0.shop/api/create-order",
      qs.stringify(payload),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    const payUrl =
      response.data.payment_url ||
      (response.data.result && response.data.result.payment_url);

    if (
      response.data &&
      (response.data.status === true || response.data.status === "SUCCESS") &&
      payUrl
    ) {
      await db.collection("PendingOrders").doc(order_id).set({
        order_id,
        uid,
        amount: Number(amount),
        status: "PENDING",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.json({
        status: true,
        payment_url: payUrl,
        order_id
      });
    } else {
      return res.json({
        status: false,
        message: response.data?.message || "Gateway Error"
      });
    }
  } catch (err) {
    console.error("create-order error:", err.message);
    res.status(500).json({
      status: false,
      message: "Server Error"
    });
  }
});

/* ─────────────────────────────────────────────
   CHECK ORDER STATUS
───────────────────────────────────────────── */
app.post("/check-order-status", async (req, res) => {
  try {
    const { order_id } = req.body;

    if (!order_id) {
      return res.status(400).json({
        status: false,
        message: "order_id required"
      });
    }

    const response = await axios.post(
      "https://pay0.shop/api/check-order-status",
      qs.stringify({
        user_token: PAY0_TOKEN,
        order_id
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    res.json(response.data);
  } catch (err) {
    console.error("check-order-status error:", err.message);
    res.status(500).json({
      status: false,
      message: "Server Error"
    });
  }
});

/* ─────────────────────────────────────────────
   WEBHOOK
───────────────────────────────────────────── */
app.all("/webhook", async (req, res) => {
  const isGet = req.method === "GET";
  const data = isGet ? req.query : req.body;

  console.log(`Webhook [${req.method}]:`, JSON.stringify(data));

  try {
    const order_id = data.order_id || data.client_txn_id || data.txn_id;

    if (!order_id) {
      if (isGet) return sendAppRedirect(res, "failed", "", "invalid_data");
      return res.send("OK");
    }

    if (!db) {
      return res.status(500).send("DB error");
    }

    if (isGet) {
      await new Promise(resolve => setTimeout(resolve, 4000));
    }

    const orderRef = db.collection("PendingOrders").doc(order_id);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      if (isGet) return sendAppRedirect(res, "failed", order_id, "order_not_found");
      return res.send("OK");
    }

    const orderData = orderDoc.data();

    if (orderData.status === "CREDITED") {
      if (isGet) return sendAppRedirect(res, "success", order_id, "");
      return res.send("OK");
    }

    const checkRes = await axios.post(
      "https://pay0.shop/api/check-order-status",
      qs.stringify({
        user_token: PAY0_TOKEN,
        order_id
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    const apiData = checkRes.data || {};
    let isSuccess = false;
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
        isSuccess = true;
      }
    }

    if (isSuccess) {
      const uid = orderData.uid;
      const amount = Number(orderData.amount);
      const userRef = db.collection("Users").doc(uid);

      await db.runTransaction(async (t) => {
        const userDoc = await t.get(userRef);
        const current = userDoc.exists ? (userDoc.data().depositBalance || 0) : 0;

        t.set(userRef, { depositBalance: current + amount }, { merge: true });

        t.update(orderRef, {
          status: "CREDITED",
          creditedAt: admin.firestore.FieldValue.serverTimestamp()
        });

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

      console.log(`✅ ₹${amount} credited to ${uid}`);

      /* NOTIFICATION */
      await sendNotification(
        "Deposit Successful 💰",
        `₹${amount} added successfully to wallet`,
        [uid]
      );

      if (isGet) return sendAppRedirect(res, "success", order_id, "");
      return res.send("OK");

    } else {
      if (isGet) return sendAppRedirect(res, "failed", order_id, "payment_incomplete");
      return res.send("OK");
    }

  } catch (err) {
    console.error("Webhook error:", err.message);
    if (isGet) return sendAppRedirect(res, "failed", "", "server_error");
    res.status(500).send("Error");
  }
});

/* ─────────────────────────────────────────────
   START SERVER
───────────────────────────────────────────── */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
