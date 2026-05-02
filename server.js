// server.js
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const axios = require("axios");
const qs = require("querystring");

const app = express();

app.use(cors());
app.use(express.json()); // Parses application/json
app.use(express.urlencoded({ extended: true })); // <-- ADDED: Parses application/x-www-form-urlencoded from payment gateways

/* ---------------- FIREBASE INIT ---------------- */
let db = null; // Initialize as null to check later safely

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
      redirect_url: "https://battlezonex-backend.onrender.com/webhook",  // User gets redirected here
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

/* ---------------- WEBHOOK (POST & GET) ---------------- */
// Use app.all so it catches POST (server webhook) and GET (user redirect)
app.all("/webhook", async (req, res) => {
  // If it's a GET request, the data might be in the URL query instead of the body
  const data = req.method === "GET" ? req.query : req.body; 

  console.log(`Received Webhook Data via ${req.method}:`, data);

  try {
    if (data.status === "SUCCESS") {
      const uid = data.remark1;   
      const amount = Number(data.amount);  

      // Safety check: Ensure Firebase is actually connected before trying to write
      if (!db) {
        console.error("Database not initialized. Cannot update coins.");
        return res.status(500).send("Database connection error");
      }

      // Safety check: Ensure we have a valid UID and Amount
      if (uid && amount) {
        const userRef = db.collection("users").doc(uid);
        const user = await userRef.get();

        if (!user.exists) {
          await userRef.set({ coins: amount });
        } else {
          let oldCoins = user.data().coins || 0;
          await userRef.update({ coins: oldCoins + amount });
        }
        console.log(`Coins Added ✔️ : ${amount} to User: ${uid}`);
      } else {
        console.log("Missing UID or Amount in webhook data");
      }
    }

    // If it was a GET redirect, send the user to a success screen or deep link
    if (req.method === "GET") {
      res.send("<h1>Payment Processed. You can return to the app now!</h1>");
    } else {
      res.send("OK"); // Acknowledge the POST webhook to Pay0
    }
    
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
