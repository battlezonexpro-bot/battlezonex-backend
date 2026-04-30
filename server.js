const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const axios = require("axios");
const qs = require("querystring");

const app = express();

app.use(cors());
app.use(express.json());

/* SAFE FIREBASE INIT */
let db;

try {

  if (process.env.FIREBASE_CONFIG) {

    const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });

    db = admin.firestore();

    console.log("Firebase Connected");

  } else {
    console.log("FIREBASE_CONFIG missing");
  }

} catch (e) {
  console.log("Firebase Error:", e.message);
}

/* HOME */
app.get("/", (req, res) => {
  res.send("BattleZoneX Backend Running");
});

/* CREATE ORDER */
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
      user_token: process.env.PAY0_API_KEY,
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

    res.json(response.data);

  } catch (e) {
    console.log("Create Error:", e.message);
    res.status(500).json({ status: false });
  }

});

/* WEBHOOK */
app.post("/webhook", async (req, res) => {

  try {

    const data = req.body;
    console.log("Webhook:", data);

    if (db && data.txnStatus === "SUCCESS") {

      await db.collection("payments").add({
        uid: data.remark1,
        amount: data.amount,
        orderId: data.orderId,
        utr: data.utr,
        status: "success",
        createdAt: Date.now()
      });

      console.log("Saved");
    }

    res.send("OK");

  } catch (e) {
    console.log(e.message);
    res.status(500).send("Error");
  }

});

/* PORT (MOST IMPORTANT) */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server Running on", PORT);
});
