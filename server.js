const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
   res.send("BattleZoneX Backend Running");
});

app.post("/webhook", async (req, res) => {

   try {

      const data = req.body;

      console.log(data);

      if(data.status === "SUCCESS"){

         await db.collection("payments").add({
            uid: data.uid,
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
   console.log("Server Running");
});
