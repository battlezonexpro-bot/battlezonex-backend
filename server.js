require("dotenv").config();
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const axios = require("axios");
const path = require("path");
const qs = require("querystring");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

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
      subtitle: { en: options.subtitle || "⚡ BattlexClash — Play. Win. Dominate." },
      android_channel_id: "f9b63a0c-c679-44ed-8fe6-ab6039119031",
      android_accent_color: "FFD4AF37", // Premium Gold
      priority: 10,
      android_visibility: 1,
      ttl: 3600,
      big_picture: options.big_picture || options.image || "",
      large_icon: options.large_icon || "https://res.cloudinary.com/dqai5ofpf/image/upload/v1/logo_premium",
      small_icon: "ic_stat_onesignal_default",
      url: options.url || "",
      buttons: options.buttons || [
        { "id": "open_app",  "text": " Open App",    "icon": "" },
        { "id": "play_now",  "text": " Play Now",    "icon": "" }
      ]
    };

    payload.android_led_color = "FFD4AF37";
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
app.get("/", (req, res) => res.send("🚀 BattlexClash Production Backend Online"));

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
      remark2: "BattlexClash"
    };

    const response = await axios.post("https://pay0.shop/api/create-order", qs.stringify(payload), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });

    const payUrl = response.data.payment_url || (response.data.result && response.data.result.payment_url);
    if (response.data && (response.data.status === true || response.data.status === "SUCCESS") && payUrl) {
      await db.collection("PendingOrders").doc(order_id).set({
        order_id, uid, amount: Number(amount), status: "PENDING", createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      await db.collection("Deposits").doc(order_id).set({
        depositId: order_id, orderId: order_id, userId: uid, amount: Number(amount), status: "Pending", type: "Deposit", timestamp: Date.now()
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
      await sendNotification(
        "Payment Successful!",
        `₹${amount} has been credited to your BattlexClash wallet.\n🪙 Coins added! Time to dominate the battlefield. 🔥`,
        [uid],
        {
          subtitle: "💳 Transaction Confirmed — BattlexClash",
          buttons: [
            { id: "wallet",   text: "View Wallet",  icon: "" },
            { id: "play_now", text: "Play Now",     icon: "" }
          ]
        }
      );
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
       await sendNotification(
         "🎯 New Player Joined Your Match!",
         `👤 ${ign} has joined "${matchDataForNotif.title}"\n🏆 Your match is filling up fast — get ready to battle! ⚔️`,
         [matchDataForNotif.hostUid],
         {
           subtitle: "Match Update — BattlexClash",
           buttons: [
             { id: "view_match", text: " View Match", icon: "" },
             { id: "play_now",   text: "  Battle Now", icon: "" }
           ]
         }
       );
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
   NEW: IN-APP TRANSFER (SECURE)
───────────────────────────────────────────── */
app.post("/in-app-transfer", async (req, res) => {
  const { uid, amount } = req.body;
  if (!uid || !amount) return res.status(400).json({ status: false, message: "Missing fields" });

  try {
    const uRef = db.collection("Users").doc(uid);

    await db.runTransaction(async (t) => {
      const uSnap = await t.get(uRef);
      if (!uSnap.exists) throw new Error("User not found");
      const winBal = uSnap.data().winningBalance || 0;
      const depBal = uSnap.data().depositBalance || 0;
      
      if (winBal < amount) throw new Error("Insufficient Winning Balance!");
      
      t.update(uRef, { 
        winningBalance: winBal - Number(amount),
        depositBalance: depBal + Number(amount)
      });
      
      const txRef = db.collection("Deposits").doc();
      t.set(txRef, {
        depositId: txRef.id,
        orderId: txRef.id,
        userId: uid,
        amount: Number(amount),
        status: "Confirmed",
        type: "In-App Transfer",
        gateway: "Internal",
        timestamp: Date.now()
      });
    });

    res.json({ status: true, message: "Transferred Successfully to Deposit Wallet" });
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

/* ─────────────────────────────────────────────
   PAYMENT SUCCESS PAGE (Inline HTML + CSS)
───────────────────────────────────────────── */
app.get('/payment-success', (req, res) => {
  const amount = req.query.amount || '';
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Payment Successful – BattlexClash</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap" rel="stylesheet"/>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #0d0d1a 0%, #111827 50%, #0d1f0d 100%);
      font-family: 'Inter', sans-serif;
      overflow: hidden;
    }

    /* Glow background blobs */
    body::before {
      content: '';
      position: fixed;
      top: -150px; left: -150px;
      width: 500px; height: 500px;
      background: radial-gradient(circle, rgba(34,197,94,0.15) 0%, transparent 70%);
      animation: blobMove 6s ease-in-out infinite alternate;
      pointer-events: none;
    }
    body::after {
      content: '';
      position: fixed;
      bottom: -150px; right: -150px;
      width: 500px; height: 500px;
      background: radial-gradient(circle, rgba(212,175,55,0.12) 0%, transparent 70%);
      animation: blobMove 8s ease-in-out infinite alternate-reverse;
      pointer-events: none;
    }
    @keyframes blobMove {
      from { transform: translate(0,0) scale(1); }
      to   { transform: translate(40px,40px) scale(1.1); }
    }

    /* Card */
    .card {
      position: relative;
      background: rgba(255,255,255,0.05);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 24px;
      padding: 3rem 2.5rem;
      text-align: center;
      max-width: 380px;
      width: 90%;
      box-shadow: 0 25px 60px rgba(0,0,0,0.5), 0 0 40px rgba(34,197,94,0.08);
      animation: cardPop 0.7s cubic-bezier(0.34,1.56,0.64,1) forwards;
      opacity: 0;
    }
    @keyframes cardPop {
      from { opacity: 0; transform: scale(0.75) translateY(30px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }

    /* Check icon */
    .icon-wrap {
      width: 90px; height: 90px;
      background: linear-gradient(135deg, #22c55e, #16a34a);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1.5rem;
      box-shadow: 0 0 0 12px rgba(34,197,94,0.12), 0 0 0 24px rgba(34,197,94,0.06);
      animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%,100% { box-shadow: 0 0 0 12px rgba(34,197,94,0.12), 0 0 0 24px rgba(34,197,94,0.06); }
      50%      { box-shadow: 0 0 0 18px rgba(34,197,94,0.18), 0 0 0 36px rgba(34,197,94,0.04); }
    }
    .icon-wrap svg { width: 44px; height: 44px; }

    /* Title */
    h1 {
      font-size: 1.8rem;
      font-weight: 900;
      color: #ffffff;
      letter-spacing: -0.5px;
      margin-bottom: 0.5rem;
    }

    /* Subtitle */
    .subtitle {
      font-size: 1rem;
      color: rgba(255,255,255,0.65);
      margin-bottom: 1.8rem;
      line-height: 1.5;
    }

    /* Amount badge */
    .amount-badge {
      display: inline-block;
      background: linear-gradient(135deg, #d4af37, #f5d76e);
      color: #1a1a00;
      font-weight: 700;
      font-size: 1.1rem;
      border-radius: 50px;
      padding: 0.45rem 1.4rem;
      margin-bottom: 1.8rem;
      letter-spacing: 0.5px;
    }

    /* Coins text */
    .coins-text {
      background: linear-gradient(90deg, #22c55e, #86efac);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      font-size: 1.05rem;
      font-weight: 600;
      margin-bottom: 2rem;
    }

    /* Divider */
    hr {
      border: none;
      border-top: 1px solid rgba(255,255,255,0.1);
      margin: 0 0 1.5rem;
    }

    /* Footer note */
    .footer-note {
      font-size: 0.78rem;
      color: rgba(255,255,255,0.35);
    }

    /* Confetti dots */
    .confetti {
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none;
      overflow: hidden;
      z-index: -1;
    }
    .dot {
      position: absolute;
      width: 8px; height: 8px;
      border-radius: 50%;
      animation: fall linear infinite;
      opacity: 0.7;
    }
    @keyframes fall {
      0%   { transform: translateY(-20px) rotate(0deg); opacity: 0.7; }
      100% { transform: translateY(110vh)  rotate(360deg); opacity: 0; }
    }
  </style>
</head>
<body>

  <!-- Confetti -->
  <div class="confetti" id="confetti"></div>

  <div class="card">
    <div class="icon-wrap">
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M5 13l4 4L19 7" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>

    <h1>Payment Successful! 🎉</h1>
    <p class="subtitle">Your transaction has been completed successfully.</p>

    ${amount ? `<div class="amount-badge">₹${amount} Received</div>` : ''}

    <p class="coins-text">🪙 Coins Added to Your Wallet!</p>

    <hr/>
    <p class="footer-note">BattlexClash · Thank you for playing 🔥</p>
  </div>

  <script>
    // Generate confetti dots
    const colors = ['#22c55e','#d4af37','#60a5fa','#f472b6','#a78bfa','#fb923c'];
    const container = document.getElementById('confetti');
    for (let i = 0; i < 40; i++) {
      const dot = document.createElement('div');
      dot.className = 'dot';
      dot.style.left = Math.random() * 100 + 'vw';
      dot.style.width = dot.style.height = (Math.random() * 8 + 5) + 'px';
      dot.style.background = colors[Math.floor(Math.random() * colors.length)];
      dot.style.animationDuration = (Math.random() * 4 + 3) + 's';
      dot.style.animationDelay = (Math.random() * 3) + 's';
      container.appendChild(dot);
    }
  </script>
</body>
</html>`);
});
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
