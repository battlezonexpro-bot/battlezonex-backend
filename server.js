const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const axios = require("axios");
const qs = require("querystring");

const app = express();

app.use(cors());
app.use(express.json()); // For parsing application/json

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
      redirect_url: "https://battlezonex-backend.onrender.com/webhook",  // Webhook URL after payment
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

    res.json(response.data);
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ status: false, message: "Server Error" });
  }
});

/* ---------------- WEBHOOK ---------------- */
app.post("/webhook", async (req, res) => {
  const data = req.body; // Get the webhook data from Pay0

  console.log("Received Webhook Data:", data);  // Print the webhook data in logs

  try {
    if (data.status === "SUCCESS") {
      const uid = data.remark1;   // User ID from webhook data
      const amount = Number(data.amount);  // Amount to be added

      // Access Firestore and update coins for the user
      const userRef = db.collection("users").doc(uid);
      const user = await userRef.get();

      if (!user.exists) {
        // Create new user with coins
        await userRef.set({ coins: amount });
      } else {
        // Update existing user coins
        let oldCoins = user.data().coins || 0;
        await userRef.update({ coins: oldCoins + amount });
      }

      console.log("Coins Added ✔️");
    }

    res.send("OK");  // Respond back to Pay0 with success
  } catch (error) {
    console.log("Error in webhook processing:", error);
    res.status(500).send("Error processing webhook");
  }
});

/* ---------------- START SERVER ---------------- */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server Running on port ${PORT}`);
});
