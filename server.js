const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const axios = require("axios");
const qs = require("querystring");

const app = express();

app.use(cors());
app.use(express.json());

/* Firebase Safe Init */
let serviceAccount;

try {
  serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

} catch (e) {
  console.log("Firebase config error:", e.message);
}

const db = admin.firestore();

/* Keys */
const PAY0_API_KEY = process.env.PAY0_API_KEY;

/* Home */
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

  } catch (e) {
    console.log("Create Order Error:", e?.response?.data || e.message);
    res.status(500).json({ status: false, message: "Server Error" });
  }

});

/* WEBHOOK */
app.post("/webhook", async (req, res) => {

  try {

    const data = req.body;

    console.log("Webhook:", data);

    if (data.txnStatus === "SUCCESS") {

      await db.collection("payments").add({
        uid: data.remark1,
        orderId: data.orderId,
        amount: data.amount,
        utr: data.utr,
        status: "success",
        createdAt: Date.now()
      });

      console.log("Payment Saved");
    }

    res.send("OK");

  } catch (e) {
    console.log(e);
    res.status(500).send("Error");
  }

});

/* PORT */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server Running on " + PORT);
});
