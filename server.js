const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const axios = require("axios");
const qs = require("querystring");
console.log("PAYLOAD:", data);
console.log("RESPONSE:", response.data);
const app = express();

app.use(cors());
app.use(express.json());

/* Firebase Init */
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

/* Keys */
const PAY0_API_KEY = process.env.PAY0_API_KEY;

/* Home */
app.get("/", (req, res) => {
  res.send("BattleZoneX Backend Running");
});

/* CREATE ORDER (Pay0) */
app.post("/create-order", async (req, res) => {

  try {

    const {
      customer_mobile,
      customer_name,
      amount,
      order_id,
      uid
    } = req.body;

    const data = {
      customer_mobile,
      customer_name,
      user_token: PAY0_API_KEY,
      amount,
      order_id,
      redirect_url: "https://battlezonex-backend.onrender.com/success",
      remark1: uid,
      remark2: "BattleZoneX"
    };

    const response = await axios.post(
      "https://pay0.shop/api/create-order",
      qs.stringify(data),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    res.json(response.data);

  } catch (e) {
    console.log(e);
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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server Running on " + PORT);
});
