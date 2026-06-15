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
   ONESIGNAL FUNCTION
───────────────────────────────────────────── */
async function sendNotification(title, message, uids = null, options = {}) {
  try {
    let payload = {
      app_id: ONE_SIGNAL_APP_ID,
      headings: { en: title },
      contents: { en: message },
      android_channel_id: "f9b63a0c-c679-44ed-8fe6-ab6039119031", 
      android_accent_color: "FFE53935", 
      priority: 10,               
      android_visibility: 1,      
      ttl: 3600,                  
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
    console.log("✅ Ultra High-Priority Push Sent (Channel Bound)");
  } catch (err) {
    console.log("❌ Push Error:", err.response?.data || err.message);
  }
}

/* ─────────────────────────────────────────────
   HOME
───────────────────────────────────────────── */
app.get("/", (req, res) => res.send("🚀 BattleZoneX Production Backend Online"));

/* ─────────────────────────────────────────────
   NOTIFICATION API
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
   CREATE ORDER (PAY0)
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
   WEBHOOK (PAY0)
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

/* ─────────────────────────────────────────────
   NEW: JOIN MATCH (SECURE)
───────────────────────────────────────────── */
app.post("/join-match", async (req, res) => {
  const { matchId, uid, ign } = req.body;
  if (!matchId || !uid || !ign) return res.status(400).json({ status: false, message: "Missing fields" });

  try {
    const matchQuery = await db.collection("Matches").where("matchId", "==", matchId).get();
    if (matchQuery.empty) return res.status(400).json({ status: false, message: "Match not found" });
    const matchRef = matchQuery.docs[0].ref;
    const userRef = db.collection("Users").doc(uid);

    let matchDataForNotif = null;

    await db.runTransaction(async (t) => {
      const userDoc = await t.get(userRef);
      const matchDoc = await t.get(matchRef);

      if (!userDoc.exists) throw new Error("User profile not found! Please restart app.");
      const mData = matchDoc.data();
      matchDataForNotif = mData;
      if (mData.status !== "Upcoming") throw new Error("This match is no longer upcoming!");

      let initialFee = mData.entryFee || 0;
      let remFee = initialFee;
      let uData = userDoc.data();
      let bon = uData.bonusBalance || 0;
      let dep = uData.depositBalance || 0;
      let win = uData.winningBalance || 0;

      const joined = mData.joinedSpots || 0;
      const total = mData.totalSpots || 0;
      const players = Array.isArray(mData.joinedPlayers) ? [...mData.joinedPlayers] : [];
      const igns = Array.isArray(mData.joinedIGNs) ? [...mData.joinedIGNs] : [];

      while(igns.length < players.length) igns.push("Player");

      if (players.includes(uid)) throw new Error("You have already joined this match!");
      if (joined >= total) throw new Error("This match is already full!");

      if (bon >= remFee) { bon -= remFee; remFee = 0; }
      else {
        remFee -= bon; bon = 0;
        if (dep >= remFee) { dep -= remFee; remFee = 0; }
        else {
          remFee -= dep; dep = 0;
          if (win >= remFee) { win -= remFee; remFee = 0; }
          else throw new Error("Insufficient Balance! Please add money to your wallet.");
        }
      }

      t.update(userRef, { bonusBalance: bon, depositBalance: dep, winningBalance: win });
      const emptyIdx = players.findIndex(p => !p || p === "" || p === "Player");
      if (emptyIdx !== -1) {
        players[emptyIdx] = uid;
        igns[emptyIdx] = ign;
      } else {
        players.push(uid);
        igns.push(ign);
      }
      t.update(matchRef, { joinedSpots: joined + 1, joinedPlayers: players, joinedIGNs: igns });
      
      const txRef = db.collection("Transactions").doc();
      t.set(txRef, {
        userId: uid,
        uid: uid,
        amount: initialFee,
        type: "Match Join",
        title: mData.title || "Match",
        status: "Success",
        timestamp: Date.now()
      });
    });

    res.json({ status: true, message: "Joined successfully!" });

    if (matchDataForNotif && matchDataForNotif.isPlayerHosted && matchDataForNotif.hostUid && matchDataForNotif.hostUid !== uid) {
       await sendNotification("Player Joined!", `${ign} joined your match: ${matchDataForNotif.title}`, [matchDataForNotif.hostUid]);
       await db.collection("Notifications").add({
          title: "Player Joined!",
          message: `${ign} joined your match: ${matchDataForNotif.title}`,
          timestamp: Date.now(),
          uid: matchDataForNotif.hostUid
       });
    }

  } catch(err) {
    res.status(400).json({ status: false, message: err.message });
  }
});

/* ─────────────────────────────────────────────
   NEW: DAILY SPIN (SECURE)
───────────────────────────────────────────── */
app.post("/claim-spin", async (req, res) => {
  const { uid, bonusAmount } = req.body;
  if (!uid || bonusAmount == null) return res.status(400).json({ status: false, message: "Missing fields" });

  try {
    const ref = db.collection("Users").doc(uid);
    await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error("User not found");
      const current = snap.data().bonusBalance || 0;
      t.update(ref, { 
         bonusBalance: current + Number(bonusAmount), 
         lastSpinTime: Date.now() 
      });
    });
    res.json({ status: true, message: `You won ₹${bonusAmount} Bonus!` });
  } catch(err) {
    res.status(400).json({ status: false, message: err.message });
  }
});

/* ─────────────────────────────────────────────
   NEW: WITHDRAWAL (SECURE)
───────────────────────────────────────────── */
app.post("/request-withdrawal", async (req, res) => {
  const { uid, amount, upiId, qrUrl } = req.body;
  if (!uid || !amount || !upiId) return res.status(400).json({ status: false, message: "Missing fields" });

  try {
    const uRef = db.collection("Users").doc(uid);
    const wRef = db.collection("Withdrawals").doc();

    await db.runTransaction(async (t) => {
      const uSnap = await t.get(uRef);
      if (!uSnap.exists) throw new Error("User not found");
      const winBal = uSnap.data().winningBalance || 0;
      if (winBal < amount) throw new Error("Insufficient Winning Balance!");
      
      t.update(uRef, { winningBalance: winBal - Number(amount) });
      
      const withdrawData = {
        withdrawId: wRef.id,
        userId: uid,
        userName: uSnap.data().name || "Player",
        amount: Number(amount),
        upiId,
        method: "UPI",
        status: "Pending",
        timestamp: Date.now()
      };
      if (qrUrl) withdrawData.upiQrUrl = qrUrl;
      
      t.set(wRef, withdrawData);
    });

    res.json({ status: true, message: "Withdrawal Requested Successfully" });
  } catch(err) {
    res.status(400).json({ status: false, message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
         
