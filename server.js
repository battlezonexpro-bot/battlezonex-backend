const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
   res.send("BattleZoneX Backend Running");
});

app.post("/webhook", (req, res) => {

   const data = req.body;

   console.log(data);

   if(data.status === "SUCCESS"){
      console.log("Payment Success");
   }

   res.send("OK");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
   console.log("Server Running");
});
