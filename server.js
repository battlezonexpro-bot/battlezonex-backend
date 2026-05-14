require("dotenv").config();
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
   151    MANUAL NOTIFICATION API
   152 ───────────────────────────────────────────── */
   153 app.all("/send-notification", async (req, res) => {
   154   try {
   155     const title = req.query.title || req.body.title;
   156     const message = req.query.message || req.body.message;
   157     const uids = req.query.uids || req.body.uids;
   158     const exclude_uids = req.query.exclude_uids || req.body.exclude_uids;
   159
   160     if (!title || !message) {
   161       return res.status(400).json({
   162         status: false,
   163         message: "Missing title/message."
   164       });
   165     }
   166
   167     let parsedUids = uids;
   168     let parsedExcludeUids = exclude_uids;
   169
   170     if (typeof uids === 'string') parsedUids = [uids];
   171     if (typeof exclude_uids === 'string') parsedExcludeUids =
       [exclude_uids];
   172
   173     await sendNotification(title, message, parsedUids, parsedExcludeUids);
   174
   175     res.json({
   176       status: true,
   177       message: "Notification Sent"
   178     });
   179
   180   } catch (err) {
   181     console.log(err.message);
   182
   183     res.status(500).json({
   184       status: false,
   185       message: "Server Error"
   186     });
   187   }
   188 });
   189
   190 /* ─────────────────────────────────────────────
   191    CREATE ORDER
   192 ───────────────────────────────────────────── */
   193 app.post("/create-order", async (req, res) => {
   194   try {
   195     const { uid, customer_mobile, customer_name, amount } = req.body;
   196
   197     if (!uid || !amount || !customer_mobile) {
   198       return res.status(400).json({
   199         status: false,
   200         message: "Missing fields"
   201       });
   202     }
   203
   204     const order_id = `BZX_${uid.slice(0, 8)}_${Date.now()}`;
   205
   206     const payload = {
   207       customer_mobile,
   208       customer_name: customer_name || "Player",
   209       user_token: PAY0_TOKEN,
   210       amount: String(amount),
   211       order_id,
   212       redirect_url: `${BACKEND_URL}/webhook?order_id=${order_id}`,
   213       remark1: uid,
   214       remark2: "BattleZoneX"
   215     };
   216
   217     const response = await axios.post(
   218       "https://pay0.shop/api/create-order",
   219       qs.stringify(payload),
   220       {
   221         headers: {
   222           "Content-Type": "application/x-www-form-urlencoded"
   223         }
   224       }
   225     );
   226
   227     const payUrl =
   228       response.data.payment_url ||
   229       (response.data.result && response.data.result.payment_url);
   230
   231     if (
   232       response.data &&
   233       (response.data.status === true || response.data.status ===
       "SUCCESS") &&
   234       payUrl
   235     ) {
   236       await db.collection("PendingOrders").doc(order_id).set({
   237         order_id,
   238         uid,
   239         amount: Number(amount),
   240         status: "PENDING",
   241         createdAt: admin.firestore.FieldValue.serverTimestamp()
   242       });
   243
   244       return res.json({
   245         status: true,
   246         payment_url: payUrl,
   247         order_id
   248       });
   249     } else {
   250       return res.json({
   251         status: false,
   252         message: response.data?.message || "Gateway Error"
   253       });
   254     }
   255   } catch (err) {
   256     console.error("create-order error:", err.message);
   257     res.status(500).json({
   258       status: false,
   259       message: "Server Error"
   260     });
   261   }
   262 });
   263
   264 /* ─────────────────────────────────────────────
   265    CHECK ORDER STATUS
   266 ───────────────────────────────────────────── */
   267 app.post("/check-order-status", async (req, res) => {
   268   try {
   269     const { order_id } = req.body;
   270
   271     if (!order_id) {
   272       return res.status(400).json({
   273         status: false,
   274         message: "order_id required"
   275       });
   276     }
   277
   278     const response = await axios.post(
   279       "https://pay0.shop/api/check-order-status",
   280       qs.stringify({
   281         user_token: PAY0_TOKEN,
   282         order_id
   283       }),
   284       {
   285         headers: {
   286           "Content-Type": "application/x-www-form-urlencoded"
   287         }
   288       }
   289     );
   290
   291     res.json(response.data);
   292   } catch (err) {
   293     console.error("check-order-status error:", err.message);
   294     res.status(500).json({
   295       status: false,
   296       message: "Server Error"
   297     });
   298   }
   299 });
   300
   301 /* ─────────────────────────────────────────────
   302    WEBHOOK
   303 ───────────────────────────────────────────── */
   304 app.all("/webhook", async (req, res) => {
   305   const isGet = req.method === "GET";
   306   const data = isGet ? req.query : req.body;
   307
   308   console.log(`Webhook [${req.method}]:`, JSON.stringify(data));
   309
   310   try {
   311     const order_id = data.order_id || data.client_txn_id || data.txn_id;
   312
   313     if (!order_id) {
   314       if (isGet) return sendAppRedirect(res, "failed", "",
       "invalid_data");
   315       return res.send("OK");
   316     }
   317
   318     if (!db) {
   319       return res.status(500).send("DB error");
   320     }
   321
   322     if (isGet) {
   323       await new Promise(resolve => setTimeout(resolve, 4000));
   324     }
   325
   326     const orderRef = db.collection("PendingOrders").doc(order_id);
   327     const orderDoc = await orderRef.get();
   328
   329     if (!orderDoc.exists) {
   330       if (isGet) return sendAppRedirect(res, "failed", order_id,
       "order_not_found");
   331       return res.send("OK");
   332     }
   333
   334     const orderData = orderDoc.data();
   335
   336     if (orderData.status === "CREDITED") {
   337       if (isGet) return sendAppRedirect(res, "success", order_id, "");
   338       return res.send("OK");
   339     }
   340
   341     const checkRes = await axios.post(
   342       "https://pay0.shop/api/check-order-status",
   343       qs.stringify({
   344         user_token: PAY0_TOKEN,
   345         order_id
   346       }),
   347       {
   348         headers: {
   349           "Content-Type": "application/x-www-form-urlencoded"
   350         }
   351       }
   352     );
   353
   354     const apiData = checkRes.data || {};
   355     let isSuccess = false;
   356     const mainStatus = String(apiData.status).toUpperCase();
   357     let nestedStatus = "";
   358
   359     if (apiData.result) {
   360       nestedStatus = String(apiData.result.txnStatus ||
       apiData.result.status || "").toUpperCase();
   361     } else if (apiData.data) {
   362       nestedStatus = String(apiData.data.txnStatus || apiData.data.status
       || "").toUpperCase();
   363     }
   364
   365     if (apiData.status === true || mainStatus === "SUCCESS") {
   366       if (nestedStatus === "SUCCESS" || nestedStatus === "COMPLETED") {
   367         isSuccess = true;
   368       } else if (!apiData.result && !apiData.data) {
   369         isSuccess = true;
   370       }
   371     }
   372
   373     if (isSuccess) {
   374       const uid = orderData.uid;
   375       const amount = Number(orderData.amount);
   376       const userRef = db.collection("Users").doc(uid);
   377
   378       await db.runTransaction(async (t) => {
   379         const userDoc = await t.get(userRef);
   380         const current = userDoc.exists ? (userDoc.data().depositBalance ||
       0) : 0;
   381
   382         t.set(userRef, { depositBalance: current + amount }, { merge: true
       });
   383
   384         t.update(orderRef, {
   385           status: "CREDITED",
   386           creditedAt: admin.firestore.FieldValue.serverTimestamp()
   387         });
   388
   389         const depositRef = db.collection("Deposits").doc(order_id);
   390         t.set(depositRef, {
   391           depositId: order_id,
   392           orderId: order_id,
   393           userId: uid,
   394           amount,
   395           status: "Confirmed",
   396           gateway: "Pay0",
   397           timestamp: Date.now()
   398         });
   399       });
   400
   401       console.log(`✅ ₹${amount} credited to ${uid}`);
   402
   403       /* NOTIFICATION */
   404       await sendNotification(
   405         "Deposit Successful 💰",
   406         `₹${amount} added successfully to wallet`,
   407         [uid]
   408       );
   409
   410       if (isGet) return sendAppRedirect(res, "success", order_id, "");
   411       return res.send("OK");
   412
   413     } else {
   414       if (isGet) return sendAppRedirect(res, "failed", order_id,
       "payment_incomplete");
   415       return res.send("OK");
   416     }
   417
   418   } catch (err) {
   419     console.error("Webhook error:", err.message);
   420     if (isGet) return sendAppRedirect(res, "failed", "", "server_error");
   421     res.status(500).send("Error");
   422   }
   423 });
   424
   425 /* ─────────────────────────────────────────────
   426    START SERVER
   427 ───────────────────────────────────────────── */
   428 const PORT = process.env.PORT || 3000;
   429
   430 app.listen(PORT, () => {
   431   console.log(`🚀 Server running on port ${PORT}`);
