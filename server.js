const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();

app.use(cors());
app.use(express.json());

/* Firebase Config */
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

/* Pay0 Keys */
const PAY0_API_KEY = process.env.PAY0_API_KEY;
const PAY0_SECRET_KEY = process.env.PAY0_SECRET_KEY;

/* Home Route */
app.get("/", (req, res) => {
   res.send("BattleZoneX Backend Running");
});

/* Webhook Route */
app.post("/webhook", async (req, res) => {

   try {

      const data = req.body;

      console.log("Webhook Data:", data);

      /* Payment Success */
      if (data.status === "SUCCESS") {

         /* Duplicate Check */
         const existing = await db
            .collection("payments")
            .where("utr", "==", data.utr)
            .get();

         if (!existing.empty) {
            return res.send("Duplicate Payment");
         }

         /* Save Payment */
         await db.collection("payments").add({
            uid: data.uid || "unknown",
            amount: data.amount || "0",
            utr: data.utr || "no_utr",
            status: "success",
            paymentId: data.payment_id || "",
            apiKey: !!PAY0_API_KEY,
            secretKey: !!PAY0_SECRET_KEY,
            createdAt: Date.now()
         });

         console.log("Payment Saved");

         return res.send("Payment Success Saved");
      }

      /* Failed Payment */
      if (data.status === "FAILED") {

         await db.collection("failed_payments").add({
            uid: data.uid || "unknown",
            amount: data.amount || "0",
            utr: data.utr || "no_utr",
            status: "failed",
            createdAt: Date.now()
         });

         console.log("Payment Failed");

         return res.send("Failed Payment Saved");
      }

      res.send("Webhook Received");

   } catch (e) {

      console.log(e);
      res.status(500).send("Server Error");

   }

});

/* Start Server */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
   console.log("Server Running On Port " + PORT);
});
