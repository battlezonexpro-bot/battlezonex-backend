require("dotenv").config(); // Added so local .env variables work
     2 const express = require("express");
     3 const cors = require("cors");
     4 const admin = require("firebase-admin");
     5 const axios = require("axios");
     6 const qs = require("querystring");
     7
     8 const app = express();
     9
    10 app.use(cors());
    11 app.use(express.json());
    12 app.use(express.urlencoded({ extended: true }));
    13
    14 /* ─────────────────────────────────────────────
    15    FIREBASE INIT
    16 ───────────────────────────────────────────── */
    17 let db = null;
    18
    19 try {
    20   if (process.env.FIREBASE_CONFIG) {
    21     admin.initializeApp({
    22       credential: admin.credential.cert(
    23         JSON.parse(process.env.FIREBASE_CONFIG)
    24       )
    25     });
    26
    27     db = admin.firestore();
    28
    29     console.log("🔥 Firebase Connected");
    30   } else {
    31     console.log("❌ FIREBASE_CONFIG missing");
    32   }
    33 } catch (err) {
    34   console.log("Firebase Error:", err.message);
    35 }
    36
    37 /* ─────────────────────────────────────────────
    38    ENV VARIABLES
    39 ───────────────────────────────────────────── */
    40 const PAY0_TOKEN = process.env.PAY0_API_KEY;
    41
    42 const BACKEND_URL =
    43   process.env.BACKEND_URL ||
    44   "https://battlezonex-backend.onrender.com";
    45
    46 const ONE_SIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
    47 const ONE_SIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;
    48
    49 /* ─────────────────────────────────────────────
    50    ONESIGNAL NOTIFICATION FUNCTION
    51 ───────────────────────────────────────────── */
    52 async function sendNotification(title, message, uids = null, exclude_uids
       = null) {
    53   try {
    54     let payload = {
    55       app_id: ONE_SIGNAL_APP_ID,
    56       headings: { en: title },
    57       contents: { en: message }
    58     };
    59
    60     // Agar specifically kuch logo ko bhejna hai (Jaise direct chat ya
       result)
    61     if (uids && uids.length > 0) {
    62       payload.include_aliases = { external_id: uids };
    63       payload.target_channel = "push";
    64     } else {
    65       // Warna sabko bhejo (Broadcast)
    66       payload.included_segments = ["Total Subscriptions"];
    67
    68       // Lekin agar kisi ko exclude karna hai (Jaise Challenge Creator
       ko), toh use nikal do
    69       if (exclude_uids && exclude_uids.length > 0) {
    70         payload.exclude_aliases = { external_id: exclude_uids };
    71       }
    72     }
    73
    74     await axios.post(
    75       "https://api.onesignal.com/notifications",
    76       payload,
    77       {
    78         headers: {
    79           Authorization: `Basic ${ONE_SIGNAL_API_KEY}`,
    80           "Content-Type": "application/json"
    81         }
    82       }
    83     );
    84
    85     console.log("✅ Notification Sent");
    86   } catch (err) {
    87     console.log(
    88       "❌ Notification Error:",
    89       err.response?.data || err.message
    90     );
    91   }
    92 }
    93
    94 /* ─────────────────────────────────────────────
    95    APP REDIRECT HTML
    96 ───────────────────────────────────────────── */
    97 const sendAppRedirect = (res, status, order_id = "", reason = "") => {
    98   const deepLink =
       `battlezonex://payment?status=${status}&order_id=${order_id}&reason=${reas
       on}`;
    99
   100   res.send(`
   101     <html>
   102       <head>
   103         <meta name="viewport" content="width=device-width,
       initial-scale=1">
   104         <style>
   105           body {
   106             font-family: sans-serif;
   107             text-align: center;
   108             margin-top: 40px;
   109             background: #f9f9f9;
   110           }
   111
   112           .loader {
   113             border: 4px solid #f3f3f3;
   114             border-top: 4px solid #00695C;
   115             border-radius: 50%;
   116             width: 40px;
   117             height: 40px;
   118             animation: spin 1s linear infinite;
   119             margin: 20px auto;
   120           }
   121
   122           @keyframes spin {
   123             0% { transform: rotate(0deg); }
   124             100% { transform: rotate(360deg); }
   125           }
   126         </style>
   127       </head>
   128
   129       <body>
   130         <h3>Processing Payment...</h3>
   131         <p>Please wait...</p>
   132
   133         <div class="loader"></div>
   134
   135         <script>
   136           setTimeout(function() {
   137             window.location.href = "${deepLink}";
   138           }, 500);
   139         </script>
   140       </body>
   141     </html>
   142   `);
   143 };
   144
   145 /* ─────────────────────────────────────────────
   146    HOME
   147 ───────────────────────────────────────────── */
   148 app.get("/", (req, res) => {
   149   res.send("🚀 BattleZoneX Backend Running");
   150 });
   151
   152 /* ─────────────────────────────────────────────
   153    MANUAL NOTIFICATION API (FIXED FOR EXCLUDE_UIDS)
   154 ───────────────────────────────────────────── */
   155 app.all("/send-notification", async (req, res) => {
   156   try {
   157     const title = req.query.title || req.body.title;
   158     const message = req.query.message || req.body.message;
   159     const uids = req.query.uids || req.body.uids;
   160     const exclude_uids = req.query.exclude_uids || req.body.exclude_uids;
   161
   162     if (!title || !message) {
   163       return res.status(400).json({
   164         status: false,
   165         message: "Missing title/message."
   166       });
   167     }
   168
   169     // Convert string to array if only one ID is passed
   170     let parsedUids = uids;
   171     let parsedExcludeUids = exclude_uids;
   172
   173     if (typeof uids === 'string') parsedUids = [uids];
   174     if (typeof exclude_uids === 'string') parsedExcludeUids =
       [exclude_uids];
   175
   176     await sendNotification(title, message, parsedUids, parsedExcludeUids);
   177
   178     res.json({
   179       status: true,
   180       message: "Notification Sent"
   181     });
   182
   183   } catch (err) {
   184     console.log(err.message);
   185
   186     res.status(500).json({
   187       status: false,
   188       message: "Server Error"
   189     });
   190   }
   191 });
   192
   193 /* ─────────────────────────────────────────────
   194    CREATE ORDER
   195 ───────────────────────────────────────────── */
   196 app.post("/create-order", async (req, res) => {
   197   try {
   198     const { uid, customer_mobile, customer_name, amount } = req.body;
   199
   200     if (!uid || !amount || !customer_mobile) {
   201       return res.status(400).json({
   202         status: false,
   203         message: "Missing fields"
   204       });
   205     }
   206
   207     const order_id = `BZX_${uid.slice(0, 8)}_${Date.now()}`;
   208
   209     const payload = {
   210       customer_mobile,
   211       customer_name: customer_name || "Player",
   212       user_token: PAY0_TOKEN,
   213       amount: String(amount),
   214       order_id,
   215       redirect_url: `${BACKEND_URL}/webhook?order_id=${order_id}`,
   216       remark1: uid,
   217       remark2: "BattleZoneX"
   218     };
   219
   220     const response = await axios.post(
   221       "https://pay0.shop/api/create-order",
   222       qs.stringify(payload),
   223       {
   224         headers: {
   225           "Content-Type": "application/x-www-form-urlencoded"
   226         }
   227       }
   228     );
   229
   230     const payUrl =
   231       response.data.payment_url ||
   232       (response.data.result && response.data.result.payment_url);
   233
   234     if (
   235       response.data &&
   236       (response.data.status === true || response.data.status ===
       "SUCCESS") &&
   237       payUrl
   238     ) {
   239       await db.collection("PendingOrders").doc(order_id).set({
   240         order_id,
   241         uid,
   242         amount: Number(amount),
   243         status: "PENDING",
   244         createdAt: admin.firestore.FieldValue.serverTimestamp()
   245       });
   246
   247       return res.json({
   248         status: true,
   249         payment_url: payUrl,
   250         order_id
   251       });
   252     } else {
   253       return res.json({
   254         status: false,
   255         message: response.data?.message || "Gateway Error"
   256       });
   257     }
   258   } catch (err) {
   259     console.error("create-order error:", err.message);
   260     res.status(500).json({
   261       status: false,
   262       message: "Server Error"
   263     });
   264   }
   265 });
   266
   267 /* ─────────────────────────────────────────────
   268    CHECK ORDER STATUS
   269 ───────────────────────────────────────────── */
   270 app.post("/check-order-status", async (req, res) => {
   271   try {
   272     const { order_id } = req.body;
   273
   274     if (!order_id) {
   275       return res.status(400).json({
   276         status: false,
   277         message: "order_id required"
   278       });
   279     }
   280
   281     const response = await axios.post(
   282       "https://pay0.shop/api/check-order-status",
   283       qs.stringify({
   284         user_token: PAY0_TOKEN,
   285         order_id
   286       }),
   287       {
   288         headers: {
   289           "Content-Type": "application/x-www-form-urlencoded"
   290         }
   291       }
   292     );
   293
   294     res.json(response.data);
   295   } catch (err) {
   296     console.error("check-order-status error:", err.message);
   297     res.status(500).json({
   298       status: false,
   299       message: "Server Error"
   300     });
   301   }
   302 });
   303
   304 /* ─────────────────────────────────────────────
   305    WEBHOOK
   306 ───────────────────────────────────────────── */
   307 app.all("/webhook", async (req, res) => {
   308   const isGet = req.method === "GET";
   309   const data = isGet ? req.query : req.body;
   310
   311   console.log(`Webhook [${req.method}]:`, JSON.stringify(data));
   312
   313   try {
   314     const order_id = data.order_id || data.client_txn_id || data.txn_id;
   315
   316     if (!order_id) {
   317       if (isGet) return sendAppRedirect(res, "failed", "",
       "invalid_data");
   318       return res.send("OK");
   319     }
   320
   321     if (!db) {
   322       return res.status(500).send("DB error");
   323     }
   324
   325     if (isGet) {
   326       await new Promise(resolve => setTimeout(resolve, 4000));
   327     }
   328
   329     const orderRef = db.collection("PendingOrders").doc(order_id);
   330     const orderDoc = await orderRef.get();
   331
   332     if (!orderDoc.exists) {
   333       if (isGet) return sendAppRedirect(res, "failed", order_id,
       "order_not_found");
   334       return res.send("OK");
   335     }
   336
   337     const orderData = orderDoc.data();
   338
   339     if (orderData.status === "CREDITED") {
   340       if (isGet) return sendAppRedirect(res, "success", order_id, "");
   341       return res.send("OK");
   342     }
   343
   344     const checkRes = await axios.post(
   345       "https://pay0.shop/api/check-order-status",
   346       qs.stringify({
   347         user_token: PAY0_TOKEN,
   348         order_id
   349       }),
   350       {
   351         headers: {
   352           "Content-Type": "application/x-www-form-urlencoded"
   353         }
   354       }
   355     );
   356
   357     const apiData = checkRes.data || {};
   358     let isSuccess = false;
   359     const mainStatus = String(apiData.status).toUpperCase();
   360     let nestedStatus = "";
   361
   362     if (apiData.result) {
   363       nestedStatus = String(apiData.result.txnStatus ||
       apiData.result.status || "").toUpperCase();
   364     } else if (apiData.data) {
   365       nestedStatus = String(apiData.data.txnStatus || apiData.data.status
       || "").toUpperCase();
   366     }
   367
   368     if (apiData.status === true || mainStatus === "SUCCESS") {
   369       if (nestedStatus === "SUCCESS" || nestedStatus === "COMPLETED") {
   370         isSuccess = true;
   371       } else if (!apiData.result && !apiData.data) {
   372         isSuccess = true;
   373       }
   374     }
   375
   376     if (isSuccess) {
   377       const uid = orderData.uid;
   378       const amount = Number(orderData.amount);
   379       const userRef = db.collection("Users").doc(uid);
   380
   381       await db.runTransaction(async (t) => {
   382         const userDoc = await t.get(userRef);
   383         const current = userDoc.exists ? (userDoc.data().depositBalance ||
       0) : 0;
   384
   385         t.set(userRef, { depositBalance: current + amount }, { merge: true
       });
   386
   387         t.update(orderRef, {
   388           status: "CREDITED",
   389           creditedAt: admin.firestore.FieldValue.serverTimestamp()
   390         });
   391
   392         const depositRef = db.collection("Deposits").doc(order_id);
   393         t.set(depositRef, {
   394           depositId: order_id,
   395           orderId: order_id,
   396           userId: uid,
   397           amount,
   398           status: "Confirmed",
   399           gateway: "Pay0",
   400           timestamp: Date.now()
   401         });
   402       });
   403
   404       console.log(`✅ ₹${amount} credited to ${uid}`);
   405
   406       /* NOTIFICATION */
   407       await sendNotification(
   408         "Deposit Successful 💰",
   409         `₹${amount} added successfully to wallet`,
   410         [uid] // <-- Send only to the user who deposited money
   411       );
   412
   413       if (isGet) return sendAppRedirect(res, "success", order_id, "");
   414       return res.send("OK");
   415
   416     } else {
   417       if (isGet) return sendAppRedirect(res, "failed", order_id,
       "payment_incomplete");
   418       return res.send("OK");
   419     }
   420
   421   } catch (err) {
   422     console.error("Webhook error:", err.message);
   423     if (isGet) return sendAppRedirect(res, "failed", "", "server_error");
   424     res.status(500).send("Error");
   425   }
   426 });
   427
   428 /* ─────────────────────────────────────────────
   429    START SERVER
   430 ───────────────────────────────────────────── */
   431 const PORT = process.env.PORT || 3000;
   432
   433 app.listen(PORT, () => {
   434   console.log(`🚀 Server running on port ${PORT}`);
