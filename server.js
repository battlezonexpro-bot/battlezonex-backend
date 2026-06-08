require("dotenv").config();
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
   ENV VARIABLES
───────────────────────────────────────────── */
const PAY0_TOKEN = process.env.PAY0_API_KEY;
const BACKEND_URL = process.env.BACKEND_URL || "https://battlezonex-backend.onrender.com";
const ONE_SIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONE_SIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;

/* ─────────────────────────────────────────────
   ONESIGNAL FUNCTION (ULTRA HIGH PRIORITY)
───────────────────────────────────────────── */
async function sendNotification(title, message, uids = null, options = {}) {
  try {
    let payload = {
      app_id: ONE_SIGNAL_APP_ID,
      headings: { en: title },
      contents: { en: message },
      android_accent_color: "FFE53935", 
      priority: 10,               // High Priority for FCM
      android_visibility: 1,      // 1 = Public (Visible on lock screen)
      ttl: 3600,                  // 1 hour survival
      big_picture: options.big_picture || options.image || "", 
      url: options.url || ""
    };

    payload.android_led_color = "FFE53935";
    payload.android_sound = "notification";

    if (uids && uids.length > 0) {
      payload.include_aliases = { external_id: uids };
      payload.target_channel = "push";
    } else {
      payload.included_segments = ["Total Subscriptions"];
    }

    await axios.post("https://api.onesignal.com/notifications", payload, {
      headers: {
        Authorization: `Basic ${ONE_SIGNAL_API_KEY}`,
        "Content-Type": "application/json"
      }
    });
    console.log("✅ Ultra High-Priority Push Sent");
  } catch (err) {
    console.log("❌ Push Error:", err.response?.data || err.message);
  }
}

/* ─────────────────────────────────────────────
   HOME
───────────────────────────────────────────── */
app.get("/", (req, res) => res.send("🚀 BattleZoneX Production Backend Online"));

/* ─────────────────────────────────────────────
   NOTIFICATION API (CLEANED & FIXED)
───────────────────────────────────────────── */
app.all("/send-notification", async (req, res) => {
  try {
    const title = req.body.title || req.query.title;
    const message = req.body.message || req.query.message;
    const big_picture = req.body.big_picture || req.query.big_picture || req.body.image;
    const url = req.body.url || req.query.url;
    let inputUids = req.body.uids || req.query.uids;

    if (!title || !message) return res.status(400).json({ status: false, message: "Missing title/message" });

    let parsedUids = null;
    if (inputUids) {
      if (typeof inputUids === 'string') {
        try { parsedUids = JSON.parse(inputUids); } catch (e) { parsedUids = [inputUids]; }
      } else if (Array.isArray(inputUids)) { parsedUids = inputUids; }
    }

    await sendNotification(title, message, parsedUids, { big_picture, url });
    res.json({ status: true, message: "Notification Processed" });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
});

/* ─────────────────────────────────────────────
   CREATE ORDER
───────────────────────────────────────────── */
app.post("/create-order", async (req, res) => {
  try {
    const { uid, customer_mobile, customer_name, amount } = req.body;
    if (!uid || !amount || !customer_mobile) return res.status(400).json({ status: false, message: "Missing fields" });

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

    const response = await axios.post("https://pay0.shop/api/create-order", qs.stringify(payload), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });

    const payUrl = response.data.payment_url || (response.data.result && response.data.result.payment_url);
    if (response.data && (response.data.status === true || response.data.status === "SUCCESS") && payUrl) {
      await db.collection("PendingOrders").doc(order_id).set({
        order_id, uid, amount: Number(amount), status: "PENDING", createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return res.json({ status: true, payment_url: payUrl, order_id });
    } else {
      return res.json({ status: false, message: response.data?.message || "Gateway Error" });
    }
  } catch (err) {
    res.status(500).json({ status: false, message: "Server Error" });
  }
});

/* ─────────────────────────────────────────────
   WEBHOOK
───────────────────────────────────────────── */
app.all("/webhook", async (req, res) => {
  const data = req.method === "GET" ? req.query : req.body;
  try {
    const order_id = data.order_id || data.client_txn_id || data.txn_id;
    if (!order_id) return res.send("OK");

    const orderRef = db.collection("PendingOrders").doc(order_id);
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) return res.send("OK");

    const orderData = orderDoc.data();
    if (orderData.status === "CREDITED") return res.send("OK");

    const checkRes = await axios.post("https://pay0.shop/api/check-order-status", qs.stringify({ user_token: PAY0_TOKEN, order_id }), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });

    const apiData = checkRes.data || {};
    let isSuccess = (apiData.status === true || String(apiData.status).toUpperCase() === "SUCCESS");

    if (isSuccess) {
      const uid = orderData.uid;
      const amount = Number(orderData.amount);
      const userRef = db.collection("Users").doc(uid);
      await db.runTransaction(async (t) => {
        const userDoc = await t.get(userRef);
        const current = userDoc.exists ? (userDoc.data().depositBalance || 0) : 0;
        t.set(userRef, { depositBalance: current + amount }, { merge: true });
        t.update(orderRef, { status: "CREDITED", creditedAt: admin.firestore.FieldValue.serverTimestamp() });
        const depositRef = db.collection("Deposits").doc(order_id);
        t.set(depositRef, { depositId: order_id, orderId: order_id, userId: uid, amount, status: "Confirmed", gateway: "Pay0", timestamp: Date.now() });
      });
      await sendNotification("Deposit Successful 💰", `₹${amount} added successfully to wallet`, [uid]);
    }
    res.send("OK");
  } catch (err) { res.status(500).send("Error"); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
