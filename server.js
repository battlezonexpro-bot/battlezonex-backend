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
    60     if (uids && uids.length > 0) {
    61       payload.include_aliases = { external_id: uids };
    62       payload.target_channel = "push";
    63     } else {
    64       payload.included_segments = ["Total Subscriptions"];
    65
    66       if (exclude_uids && exclude_uids.length > 0) {
    67         payload.target_channel = "push";
    68         payload.exclude_aliases = { external_id: exclude_uids };
    69       }
    70     }
    71
    72     await axios.post(
    73       "https://api.onesignal.com/notifications",
    74       payload,
    75       {
    76         headers: {
    77           Authorization: `Basic ${ONE_SIGNAL_API_KEY}`,
    78           "Content-Type": "application/json"
    79         }
    80       }
    81     );
    82
    83     console.log("✅ Notification Sent");
    84   } catch (err) {
    85     console.log(
    86       "❌ Notification Error:",
    87       err.response?.data || err.message
    88     );
    89   }
    90 }
    91
    92 /* ─────────────────────────────────────────────
    93    APP REDIRECT HTML
    94 ───────────────────────────────────────────── */
    95 const sendAppRedirect = (res, status, order_id = "", reason = "") => {
    96   const deepLink =
       `battlezonex://payment?status=${status}&order_id=${order_id}&reason=${reas
       on}`;
    97
    98   res.send(`
    99     <html>
   100       <head>
   101         <meta name="viewport" content="width=device-width,
       initial-scale=1">
   102         <style>
   103           body {
   104             font-family: sans-serif;
   105             text-align: center;
   106             margin-top: 40px;
   107             background: #f9f9f9;
   108           }
   109
   110           .loader {
   111             border: 4px solid #f3f3f3;
   112             border-top: 4px solid #00695C;
   113             border-radius: 50%;
   114             width: 40px;
   115             height: 40px;
   116             animation: spin 1s linear infinite;
   117             margin: 20px auto;
   118           }
   119
   120           @keyframes spin {
   121             0% { transform: rotate(0deg); }
   122             100% { transform: rotate(360deg); }
   123           }
   124         </style>
   125       </head>
   126
   127       <body>
   128         <h3>Processing Payment...</h3>
   129         <p>Please wait...</p>
   130
   131         <div class="loader"></div>
   132
   133         <script>
   134           setTimeout(function() {
   135             window.location.href = "${deepLink}";
   136           }, 500);
   137         </script>
   138       </body>
   139     </html>
   140   `);
   141 };
   142
   143 /* ─────────────────────────────────────────────
   144    HOME
   145 ───────────────────────────────────────────── */
   146 app.get("/", (req, res) => {
   147   res.send("🚀 BattleZoneX Backend Running");
   148 });
   149
   150 /* ─────────────────────────────────────────────
   151    MANUAL NOTIFICATION API (FIXED FOR ARRAYS & APP)
   152 ───────────────────────────────────────────── */
   153 app.all("/send-notification", async (req, res) => {
   154   try {
   155     const title = req.query.title || req.body.title;
   156     const message = req.query.message || req.body.message;
   157     let uids = req.query.uids || req.body.uids;
   158     let exclude_uids = req.query.exclude_uids || req.body.exclude_uids;
   159
   160     if (!title || !message) {
   161       return res.status(400).json({
   162         status: false,
   163         message: "Missing title/message."
   164       });
   165     }
   166
   167     let parsedUids = [];
   168     let parsedExcludeUids = [];
   169
   170     // Convert UIDs correctly if they are coming as stringified JSON from
       Android
   171     if (uids) {
   172       if (typeof uids === 'string') {
   173         try { parsedUids = JSON.parse(uids); }
   174         catch (e) { parsedUids = [uids]; }
   175       } else if (Array.isArray(uids)) {
   176         parsedUids = uids;
   177       }
   178     }
   179
   180     if (exclude_uids) {
   181       if (typeof exclude_uids === 'string') {
   182         try { parsedExcludeUids = JSON.parse(exclude_uids); }
   183         catch (e) { parsedExcludeUids = [exclude_uids]; }
   184       } else if (Array.isArray(exclude_uids)) {
   185         parsedExcludeUids = exclude_uids;
   186       }
   187     }
   188
   189     await sendNotification(
   190       title,
   191       message,
   192       parsedUids.length > 0 ? parsedUids : null,
   193       parsedExcludeUids.length > 0 ? parsedExcludeUids : null
   194     );
   195
   196     res.json({
   197       status: true,
   198       message: "Notification Sent"
   199     });
   200
   201   } catch (err) {
   202     console.log(err.message);
   203
   204     res.status(500).json({
   205       status: false,
   206       message: "Server Error"
   207     });
   208   }
   209 });
   210
   211 /* ─────────────────────────────────────────────
   212    CREATE ORDER
   213 ───────────────────────────────────────────── */
   214 app.post("/create-order", async (req, res) => {
   215   try {
   216     const { uid, customer_mobile, customer_name, amount } = req.body;
   217
   218     if (!uid || !amount || !customer_mobile) {
   219       return res.status(400).json({
   220         status: false,
   221         message: "Missing fields"
   222       });
   223     }
   224
   225     const order_id = `BZX_${uid.slice(0, 8)}_${Date.now()}`;
   226
   227     const payload = {
   228       customer_mobile,
   229       customer_name: customer_name || "Player",
   230       user_token: PAY0_TOKEN,
   231       amount: String(amount),
   232       order_id,
   233       redirect_url: `${BACKEND_URL}/webhook?order_id=${order_id}`,
   234       remark1: uid,
   235       remark2: "BattleZoneX"
   236     };
   237
   238     const response = await axios.post(
   239       "https://pay0.shop/api/create-order",
   240       qs.stringify(payload),
   241       {
   242         headers: {
   243           "Content-Type": "application/x-www-form-urlencoded"
   244         }
   245       }
   246     );
   247
   248     const payUrl =
   249       response.data.payment_url ||
   250       (response.data.result && response.data.result.payment_url);
   251
   252     if (
   253       response.data &&
   254       (response.data.status === true || response.data.status ===
       "SUCCESS") &&
   255       payUrl
   256     ) {
   257       await db.collection("PendingOrders").doc(order_id).set({
   258         order_id,
   259         uid,
   260         amount: Number(amount),
   261         status: "PENDING",
   262         createdAt: admin.firestore.FieldValue.serverTimestamp()
   263       });
   264
   265       return res.json({
   266         status: true,
   267         payment_url: payUrl,
   268         order_id
   269       });
   270     } else {
   271       return res.json({
   272         status: false,
   273         message: response.data?.message || "Gateway Error"
   274       });
   275     }
   276   } catch (err) {
   277     console.error("create-order error:", err.message);
   278     res.status(500).json({
   279       status: false,
   280       message: "Server Error"
   281     });
   282   }
   283 });
   284
   285 /* ─────────────────────────────────────────────
   286    CHECK ORDER STATUS
   287 ───────────────────────────────────────────── */
   288 app.post("/check-order-status", async (req, res) => {
   289   try {
   290     const { order_id } = req.body;
   291
   292     if (!order_id) {
   293       return res.status(400).json({
   294         status: false,
   295         message: "order_id required"
   296       });
   297     }
   298
   299     const response = await axios.post(
   300       "https://pay0.shop/api/check-order-status",
   301       qs.stringify({
   302         user_token: PAY0_TOKEN,
   303         order_id
   304       }),
   305       {
   306         headers: {
   307           "Content-Type": "application/x-www-form-urlencoded"
   308         }
   309       }
   310     );
   311
   312     res.json(response.data);
   313   } catch (err) {
   314     console.error("check-order-status error:", err.message);
   315     res.status(500).json({
   316       status: false,
   317       message: "Server Error"
   318     });
   319   }
   320 });
   321
   322 /* ─────────────────────────────────────────────
   323    WEBHOOK
   324 ───────────────────────────────────────────── */
   325 app.all("/webhook", async (req, res) => {
   326   const isGet = req.method === "GET";
   327   const data = isGet ? req.query : req.body;
   328
   329   console.log(`Webhook [${req.method}]:`, JSON.stringify(data));
   330
   331   try {
   332     const order_id = data.order_id || data.client_txn_id || data.txn_id;
   333
   334     if (!order_id) {
   335       if (isGet) return sendAppRedirect(res, "failed", "",
       "invalid_data");
   336       return res.send("OK");
   337     }
   338
   339     if (!db) {
   340       return res.status(500).send("DB error");
   341     }
   342
   343     if (isGet) {
   344       await new Promise(resolve => setTimeout(resolve, 4000));
   345     }
   346
   347     const orderRef = db.collection("PendingOrders").doc(order_id);
   348     const orderDoc = await orderRef.get();
   349
   350     if (!orderDoc.exists) {
   351       if (isGet) return sendAppRedirect(res, "failed", order_id,
       "order_not_found");
   352       return res.send("OK");
   353     }
   354
   355     const orderData = orderDoc.data();
   356
   357     if (orderData.status === "CREDITED") {
   358       if (isGet) return sendAppRedirect(res, "success", order_id, "");
   359       return res.send("OK");
   360     }
   361
   362     const checkRes = await axios.post(
   363       "https://pay0.shop/api/check-order-status",
   364       qs.stringify({
   365         user_token: PAY0_TOKEN,
   366         order_id
   367       }),
   368       {
   369         headers: {
   370           "Content-Type": "application/x-www-form-urlencoded"
   371         }
   372       }
   373     );
   374
   375     const apiData = checkRes.data || {};
   376     let isSuccess = false;
   377     const mainStatus = String(apiData.status).toUpperCase();
   378     let nestedStatus = "";
   379
   380     if (apiData.result) {
   381       nestedStatus = String(apiData.result.txnStatus ||
       apiData.result.status || "").toUpperCase();
   382     } else if (apiData.data) {
   383       nestedStatus = String(apiData.data.txnStatus || apiData.data.status
       || "").toUpperCase();
   384     }
   385
   386     if (apiData.status === true || mainStatus === "SUCCESS") {
   387       if (nestedStatus === "SUCCESS" || nestedStatus === "COMPLETED") {
   388         isSuccess = true;
   389       } else if (!apiData.result && !apiData.data) {
   390         isSuccess = true;
   391       }
   392     }
   393
   394     if (isSuccess) {
   395       const uid = orderData.uid;
   396       const amount = Number(orderData.amount);
   397       const userRef = db.collection("Users").doc(uid);
   398
   399       await db.runTransaction(async (t) => {
   400         const userDoc = await t.get(userRef);
   401         const current = userDoc.exists ? (userDoc.data().depositBalance ||
       0) : 0;
   402
   403         t.set(userRef, { depositBalance: current + amount }, { merge: true
       });
   404
   405         t.update(orderRef, {
   406           status: "CREDITED",
   407           creditedAt: admin.firestore.FieldValue.serverTimestamp()
   408         });
   409
   410         const depositRef = db.collection("Deposits").doc(order_id);
   411         t.set(depositRef, {
   412           depositId: order_id,
   413           orderId: order_id,
   414           userId: uid,
   415           amount,
   416           status: "Confirmed",
   417           gateway: "Pay0",
   418           timestamp: Date.now()
   419         });
   420       });
   421
   422       console.log(`✅ ₹${amount} credited to ${uid}`);
   423
   424       /* NOTIFICATION */
   425       await sendNotification(
   426         "Deposit Successful 💰",
   427         `₹${amount} added successfully to wallet`,
   428         [uid]
   429       );
   430
   431       if (isGet) return sendAppRedirect(res, "success", order_id, "");
   432       return res.send("OK");
   433
   434     } else {
   435       if (isGet) return sendAppRedirect(res, "failed", order_id,
       "payment_incomplete");
   436       return res.send("OK");
   437     }
   438
   439   } catch (err) {
   440     console.error("Webhook error:", err.message);
   441     if (isGet) return sendAppRedirect(res, "failed", "", "server_error");
   442     res.status(500).send("Error");
   443   }
   444 });
   445
   446 /* ─────────────────────────────────────────────
   447    START SERVER
   448 ───────────────────────────────────────────── */
   449 const PORT = process.env.PORT || 3000;
   450
   451 app.listen(PORT, () => {
   452   console.log(`🚀 Server running on port ${PORT}`);
