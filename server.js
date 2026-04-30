const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const axios = require("axios");
const qs = require("querystring");

const app = express();

app.use(cors());
app.use(express.json());

/* ---------------- FIREBASE INIT ---------------- */
let db;

try {
  if (process.env.FIREBASE_CONFIG) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });

    db = admin.firestore();

    console.log("🔥 Firebase Connected");
  } else {
    console.log("❌ FIREBASE_CONFIG missing");
  }
} catch (err) {
  console.log("Firebase Error:", err.message);
}

/* ---------------- KEYS ---------------- */
const PAY0_API_KEY = process.env.PAY0_API_KEY;

/* ---------------- HOME ---------------- */
app.get("/", (req, res) => {
  res.send("🚀 BattleZoneX Backend Running");
});

/* ---------------- CREATE ORDER ---------------- */
app.post("/create-order", async (req, res) => {
  try {
    const {
      customer_mobile,
      customer_name,
      amount,
      order_id,
      uid
    } = req.body;

    const payload = {
      customer_mobile,
      customer_name,
      user_token: PAY0_API_KEY,
      amount,
      order_id,
      redirect_url: "https://battlezonex-backend.onrender.com/webhook",
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

    console.log("Pay0 Response:", response.data);

    res.json(response.data);

  } catch (err) {
    console.log("Create Order Error:", err.message);
    res.status(500).json({ status: false, message: "Server Error" });
  }
});

/* ---------------- WEBHOOK (COIN SYSTEM) ---------------- */
app.post("/webhook", async (req, res) => {
  try {
    const data = req.body;

    console.log("📩 Webhook:", data);

    if (data.status === "SUCCESS") {

      const uid = data.remark1;
      const amount = Number(data.amount);

      if (!db) {
        console.log("DB not ready");
        return res.send("OK");
      }

      const userRef = db.collection("users").doc(uid);
      const user = await userRef.get();

      if (!user.exists) {
        await userRef.set({
          coins: amount
        });
      } else {
        let oldCoins = user.data().coins || 0;

        await userRef.update({
          coins: oldCoins + amount
        });
      }

      console.log("💰 Coins Added:", amount);
    }

    res.send("OK");

  } catch (err) {
    console.log("Webhook Error:", err.message);
    res.status(500).send("Error");
  }
});

/* ---------------- PORT ---------------- */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Server Running on Port", PORT);
});
