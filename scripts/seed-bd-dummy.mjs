import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const env = fs.readFileSync(".env.local", "utf8");
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const ACCOUNT = "66df8a6a-1c75-4a1c-9726-6d737cba25ad";
const USER = "dec0bc81-cbce-444b-a7dd-99b55a111dd6";

const firstNames = [
  "Rahim", "Karim", "Fatima", "Ayesha", "Sakib", "Nusrat", "Tanvir", "Sumaiya",
  "Imran", "Nabila", "Rafiq", "Laila", "Hasan", "Mitu", "Arif", "Shila",
  "Farhan", "Ruma", "Mehedi", "Jannat", "Asif", "Nadia", "Shuvo", "Papia",
  "Mahmud", "Sadia", "Rakib", "Farzana", "Jahid", "Tania", "Sajid", "Moushumi",
  "Nayeem", "Rifat", "Sabbir", "Anika", "Tarek", "Shamima", "Omar", "Priya",
  "Bappy", "Keya", "Sohel", "Nishi", "Adnan", "Mim", "Fahim", "Reshma",
  "Jamal", "Salma", "Kamrul", "Orpa", "Parvez", "Dipa", "Liton", "Sultana",
  "Rasel", "Shathi", "Biplob", "Faria", "Masud", "Rumana", "Shakil", "Afrin",
  "Noman", "Mahira", "Zubair", "Sanjida", "Hridoy", "Ishrat",
];
const lastNames = [
  "Ahmed", "Hossain", "Islam", "Khan", "Rahman", "Akter", "Chowdhury",
  "Sultana", "Hasan", "Uddin", "Mia", "Begum", "Sarkar", "Das", "Roy",
  "Karim", "Mollah", "Sheikh", "Talukder", "Biswas",
];
const companies = [
  "Dawat IT", "Sony Plus Electronics", "Grameenphone Shop", "Pathao Partner",
  "Foodpanda Merchant", "Chaldal Vendor", "bKash Agent", "Nagad Point",
  "BRAC Bank Client", "Dutch-Bangla Merchant", "Unilever BD Retail",
  "Square Toiletries", "Walton Dealer", "Minister Distributor", "Pran-RFL Dealer",
  "ACI Limited", "Akij Group", "Bashundhara Group", "City Bank SME",
  "IDLC Finance", "Summit Communications", "Fiber@Home", "Link3", "Amber IT",
  "Carnival Internet", "Daraz Seller", "Evaly Merchant", "Sheba.xyz Pro",
  "Shohoz Partner", "RedX Courier",
];
const areas = [
  "Dhaka", "Chattogram", "Sylhet", "Rajshahi", "Khulna", "Barishal", "Rangpur",
  "Mymensingh", "Gazipur", "Narayanganj", "Cumilla", "Bogura", "Jashore",
  "Coxs Bazar", "Tangail",
];
const tagDefs = [
  { name: "VIP", color: "#ef4444" },
  { name: "Hot Lead", color: "#f97316" },
  { name: "Warm", color: "#eab308" },
  { name: "Cold", color: "#64748b" },
  { name: "Customer", color: "#22c55e" },
  { name: "Wholesale", color: "#3b82f6" },
  { name: "Retail", color: "#a855f7" },
  { name: "Follow-up", color: "#ec4899" },
  { name: "Dhaka", color: "#06b6d4" },
  { name: "Outside Dhaka", color: "#84cc16" },
];
const bdMsgs = [
  "Assalamualaikum, price jante chai",
  "Apnader delivery koto din e hoy?",
  "Discount pawa jabe?",
  "Cash on delivery ache?",
  "Order confirm kore din please",
  "Payment bKash e korte pari?",
  "Stock ache kina bolben",
  "Invoice pathiye din",
  "Delivery address Dhaka",
  "Thank you so much!",
  "Ki offer cholche eikhane?",
  "Warranty koto din?",
  "Showroom kothay?",
  "Ami kalke order dibo",
  "Status update din please",
];
const agentReplies = [
  "Ji, apnake help korte pari.",
  "Delivery 2-3 business day e hoy.",
  "Current offer: 10% off on prepaid.",
  "bKash / Nagad / COD sob available.",
  "Stock ache, order confirm korte pari.",
  "Invoice pathiye dicchi.",
  "Dhonnobad! Ar kichu lagle janaben.",
];
const dealTitles = [
  "Website Development", "POS Software", "Bulk Order", "Annual Maintenance",
  "SEO Package", "WhatsApp Automation Setup", "Cloud Hosting", "CCTV Package",
  "Solar Quotation", "Inventory System", "E-commerce Store", "Domain+Hosting",
  "Digital Marketing", "ERP Module", "Custom CRM Addon",
];

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const phoneFor = (i) => {
  const prefixes = ["88013", "88014", "88015", "88016", "88017", "88018", "88019"];
  const p = prefixes[i % prefixes.length];
  const rest = String(100000000 + i * 7919).slice(-8);
  return p + rest;
};

async function main() {
  // 1) Anik
  const { data: anik, error: anikErr } = await admin
    .from("contacts")
    .update({
      name: "Anik",
      email: "anik@dawatit.com",
      company: "Dawat IT",
      updated_at: new Date().toISOString(),
    })
    .eq("account_id", ACCOUNT)
    .eq("phone_normalized", "8801635328606")
    .select("id,name,phone")
    .single();
  if (anikErr) console.log("ANIK_ERR", anikErr);
  else console.log("ANIK", anik);

  // 2) Pipeline
  let pipelineId;
  const { data: existingPipe } = await admin
    .from("pipelines")
    .select("id")
    .eq("account_id", ACCOUNT)
    .limit(1)
    .maybeSingle();

  if (existingPipe) {
    pipelineId = existingPipe.id;
  } else {
    const { data: pipe, error: pipeErr } = await admin
      .from("pipelines")
      .insert({ user_id: USER, account_id: ACCOUNT, name: "Sales Pipeline BD" })
      .select("id")
      .single();
    if (pipeErr) throw pipeErr;
    pipelineId = pipe.id;
    const stageRows = [
      { name: "New Lead", position: 0, color: "#3b82f6" },
      { name: "Contacted", position: 1, color: "#8b5cf6" },
      { name: "Proposal", position: 2, color: "#f59e0b" },
      { name: "Negotiation", position: 3, color: "#f97316" },
      { name: "Won", position: 4, color: "#22c55e" },
      { name: "Lost", position: 5, color: "#ef4444" },
    ].map((s) => ({ ...s, pipeline_id: pipelineId }));
    const { error: stErr } = await admin.from("pipeline_stages").insert(stageRows);
    if (stErr) throw stErr;
  }

  const { data: stages } = await admin
    .from("pipeline_stages")
    .select("id,name,position")
    .eq("pipeline_id", pipelineId)
    .order("position");
  console.log("PIPELINE", pipelineId, "stages", stages?.length);

  // 3) Tags
  const tagIds = [];
  for (const t of tagDefs) {
    const { data: existing } = await admin
      .from("tags")
      .select("id")
      .eq("account_id", ACCOUNT)
      .eq("name", t.name)
      .maybeSingle();
    if (existing) {
      tagIds.push(existing.id);
      continue;
    }
    const { data, error } = await admin
      .from("tags")
      .insert({ user_id: USER, account_id: ACCOUNT, name: t.name, color: t.color })
      .select("id")
      .single();
    if (error) console.log("TAG_ERR", t.name, error.message);
    else tagIds.push(data.id);
  }
  console.log("TAGS", tagIds.length);

  // 4) Contacts
  const contactRows = [];
  for (let i = 0; i < 85; i++) {
    const fn = rand(firstNames);
    const ln = rand(lastNames);
    const phone = phoneFor(i);
    if (phone === "8801635328606") continue;
    contactRows.push({
      user_id: USER,
      account_id: ACCOUNT,
      phone,
      name: `${fn} ${ln}`,
      email: `${fn}.${ln}${i}@gmail.com`.toLowerCase(),
      company: `${rand(companies)} — ${rand(areas)}`,
    });
  }

  const createdContacts = [];
  for (const row of contactRows) {
    const { data, error } = await admin
      .from("contacts")
      .insert(row)
      .select("id,name,phone")
      .single();
    if (error) {
      if (error.code !== "23505") console.log("CONTACT_ERR", error.message);
    } else {
      createdContacts.push(data);
    }
  }
  console.log("CONTACTS_NEW", createdContacts.length);

  const allContacts = [...createdContacts];
  if (anik) allContacts.unshift(anik);

  // 5) Tags on contacts
  let tagLinks = 0;
  for (const c of allContacts) {
    const n = randInt(1, 3);
    const chosen = new Set();
    while (chosen.size < n && tagIds.length) chosen.add(rand(tagIds));
    for (const tag_id of chosen) {
      const { error } = await admin
        .from("contact_tags")
        .insert({ contact_id: c.id, tag_id });
      if (!error) tagLinks++;
    }
  }
  console.log("CONTACT_TAGS", tagLinks);

  // 6) Conversations + messages
  let msgCount = 0;
  let convCount = 0;
  for (const c of allContacts.slice(0, 50)) {
    const lastText = rand(bdMsgs);
    const unread = Math.random() < 0.35 ? randInt(1, 4) : 0;
    const status = rand(["open", "open", "open", "pending", "closed"]);

    let convId;
    const { data: existingConv } = await admin
      .from("conversations")
      .select("id")
      .eq("account_id", ACCOUNT)
      .eq("contact_id", c.id)
      .maybeSingle();

    if (existingConv) {
      convId = existingConv.id;
      await admin
        .from("conversations")
        .update({
          status,
          last_message_text: lastText,
          last_message_at: new Date(
            Date.now() - randInt(0, 14) * 86400000,
          ).toISOString(),
          unread_count: unread,
        })
        .eq("id", convId);
    } else {
      const { data: ins, error: iErr } = await admin
        .from("conversations")
        .insert({
          user_id: USER,
          account_id: ACCOUNT,
          contact_id: c.id,
          status,
          last_message_text: lastText,
          last_message_at: new Date().toISOString(),
          unread_count: unread,
          assigned_agent_id: Math.random() < 0.6 ? USER : null,
        })
        .select("id")
        .single();
      if (iErr) {
        console.log("CONV_ERR", iErr.message);
        continue;
      }
      convId = ins.id;
    }
    convCount++;

    const nMsg = randInt(2, 6);
    const msgs = [];
    let t0 = Date.now() - randInt(1, 10) * 86400000;
    for (let m = 0; m < nMsg; m++) {
      const fromCustomer = m % 2 === 0;
      t0 += randInt(5, 180) * 60000;
      msgs.push({
        conversation_id: convId,
        sender_type: fromCustomer ? "customer" : "agent",
        sender_id: fromCustomer ? null : USER,
        content_type: "text",
        content_text: fromCustomer ? rand(bdMsgs) : rand(agentReplies),
        status: fromCustomer ? "delivered" : rand(["sent", "delivered", "read"]),
        created_at: new Date(t0).toISOString(),
      });
    }
    const { error: mErr } = await admin.from("messages").insert(msgs);
    if (mErr) console.log("MSG_ERR", mErr.message);
    else msgCount += msgs.length;
  }
  console.log("CONVS", convCount, "MSGS", msgCount);

  // 7) Deals
  let dealCount = 0;
  for (const c of allContacts.slice(0, 45)) {
    const stage = rand(stages);
    const value = randInt(5, 250) * 1000;
    const { error: dErr } = await admin.from("deals").insert({
      user_id: USER,
      account_id: ACCOUNT,
      pipeline_id: pipelineId,
      stage_id: stage.id,
      contact_id: c.id,
      title: `${rand(dealTitles)} — ${c.name || "Client"}`,
      value,
      currency: "BDT",
      notes: `Dummy BD deal for ${c.company || c.name}`,
      status:
        stage.name === "Won" ? "won" : stage.name === "Lost" ? "lost" : "active",
      expected_close_date: new Date(Date.now() + randInt(7, 60) * 86400000)
        .toISOString()
        .slice(0, 10),
      assigned_to: USER,
    });
    if (dErr) console.log("DEAL_ERR", dErr.message);
    else dealCount++;
  }
  console.log("DEALS", dealCount);

  const { count: totalContacts } = await admin
    .from("contacts")
    .select("*", { count: "exact", head: true })
    .eq("account_id", ACCOUNT);
  const { count: totalConv } = await admin
    .from("conversations")
    .select("*", { count: "exact", head: true })
    .eq("account_id", ACCOUNT);
  const { count: totalDeals } = await admin
    .from("deals")
    .select("*", { count: "exact", head: true })
    .eq("account_id", ACCOUNT);

  console.log("TOTALS", {
    contacts: totalContacts,
    conversations: totalConv,
    deals: totalDeals,
    messages: msgCount,
    tags: tagIds.length,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
