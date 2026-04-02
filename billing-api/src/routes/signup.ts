import path from "path";
import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import Stripe from "stripe";
import { dbGet, dbRun, TIERS } from "../database.js";
import { sendApiKeyEmail, sendSignupNotification } from "../email.js";
import { provisionApiKey } from "../provisionKey.js";

const router = Router();

// GET /signup — serve signup.html
router.get("/", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "..", "..", "public", "signup.html"));
});

const DISPOSABLE_DOMAINS = new Set([
  // ── Guerrilla Mail network ────────────────────────────────────────────────
  "guerrillamail.com", "guerrillamail.net", "guerrillamail.org",
  "guerrillamail.biz", "guerrillamail.de", "guerrillamail.info",
  "guerrillamailblock.com", "grr.la", "sharklasers.com", "spam4.me",
  "guerrillamailblock.com",
  // ── Mailinator network ────────────────────────────────────────────────────
  "mailinator.com", "mailinator2.com", "suremail.info", "chammy.info",
  "tradermail.info", "streetwisemail.com", "sogetthis.com",
  "mailinater.com", "spamherelots.com", "spamhereplease.com",
  // ── 10 Minute Mail / temp services ───────────────────────────────────────
  "10minutemail.com", "10minutemail.net", "10minutemail.org",
  "10minutemail.de", "10minemail.com", "tempmail.com", "tempmail.net",
  "tempmail.org", "temp-mail.org", "temp-mail.io", "temp-mail.ru",
  "tempinbox.com", "tempinbox.co.uk", "tempr.email", "discard.email",
  "throwaway.email", "throwam.com",
  // ── Trashmail network ─────────────────────────────────────────────────────
  "trashmail.com", "trashmail.me", "trashmail.net", "trashmail.org",
  "trashmail.at", "trashmail.io", "trashmail.xyz", "trashmailer.com",
  "trashcanmail.com",
  // ── Yopmail network ───────────────────────────────────────────────────────
  "yopmail.com", "yopmail.fr", "cool.fr.nf", "jetable.fr.nf",
  "nospam.ze.tc", "nomail.xl.cx", "mega.zik.dj", "speed.1s.fr",
  "courriel.fr.nf", "moncourrier.fr.nf", "monemail.fr.nf",
  "monmail.fr.nf",
  // ── Maildrop / Mailnull / etc ─────────────────────────────────────────────
  "maildrop.cc", "mailnull.com", "mailnesia.com", "mailexpire.com",
  "mailin8r.com", "mailme24.com", "mailmetrash.com", "mailscrap.com",
  "mailsiphon.com", "mailzilla.com", "mailzilla.org",
  // ── Spamgourmet ───────────────────────────────────────────────────────────
  "spamgourmet.com", "spamgourmet.net", "spamgourmet.org",
  "spamfree24.org", "spamfree.eu",
  // ── Fake / throwaway misc ─────────────────────────────────────────────────
  "fakeinbox.com", "fakeinbox.net", "fakeinbox.org",
  "dispostable.com", "dispenseit.com", "disposemail.com",
  "getnada.com", "getairmail.com", "getonemail.com",
  "yomail.info", "zzrgg.com", "tmail.com", "mailtemp.info",
  "spamevader.com", "spamoff.de", "spamspot.com", "spamstack.net",
  "spamthis.co.uk", "spam.la", "spaml.de", "spaml.com",
  "no-spam.ws", "nospam.ze.tc", "nospamfor.us",
  "binkmail.com", "bobmail.info", "brefmail.com", "chogmail.com",
  "clixser.com", "courriertrash.com", "dacoolest.com", "dandikmail.com",
  "deadaddress.com", "deadletter.ga", "despam.it", "devnullmail.com",
  "discardmail.com", "discardmail.de", "dontmail.net", "dontreg.com",
  "dontsendmespam.de", "drdrb.com", "dudmail.com", "dump-email.info",
  "dumpandfuck.com", "dumpmail.de", "e4ward.com", "easytrashmail.com",
  "einrot.com", "emailias.com", "emailinfive.com", "emailisvalid.com",
  "emailtemporanea.com", "emailto.de", "emailwarden.com",
  "emkei.cz", "emkei.ga", "etranquil.com", "etranquil.net",
  "explosivemail.com", "eyepaste.com", "fastacura.com", "filzmail.com",
  "fivemail.de", "fleckens.hu", "frapmail.com", "fugitiveemail.com",
  "gishpuppy.com", "gowikibooks.com", "gowikicampus.com",
  "hair2email.com", "haltospam.com", "hatespam.org", "hidemail.de",
  "hidzz.com", "hMailServer.com", "hopemail.biz", "humaility.com",
  "ieatspam.eu", "ieatspam.info", "ihateyoualot.info", "iheartspam.org",
  "inboxclean.com", "inboxclean.org", "insorg.org", "ipoo.org",
  "iwi.net", "jetable.com", "jetable.net", "jetable.org",
  "jetable.pp.ua", "jnxjn.com", "junk.to", "junk1.net",
  "kasmail.com", "kaspop.com", "killmail.com", "killmail.net",
  "klassmaster.com", "klassmaster.net", "koszmail.pl", "kurzepost.de",
  "lol.ovpn.to", "lookugly.com", "lortemail.dk", "lr78.com",
  "lroid.com", "lukop.dk", "m21.cc", "mail-filter.com",
  "mail-temporaire.fr", "mail.by", "mail.mezimages.net",
  "mail2rss.org", "mail333.com", "mailbidon.com", "mailbucket.org",
  "mailchop.com", "mailcatch.com", "maildu.de", "mailfree.ga",
  "mailguard.me", "mailhazard.com", "mailhazard.us", "mailimate.com",
  "mailita.tk", "mailme.lv", "mailmoat.com", "mailna.co",
  "mailnew.com", "mailnobody.com", "mailpick.biz", "mailproxsy.com",
  "mailquack.com", "mailrock.biz", "mailseal.de",
  "mailshell.com", "mailsucker.net", "mailtome.de",
  "mailtothis.com", "mailzilla.org", "mbx.cc", "mega.zik.dj",
  "meltmail.com", "mfsa.ru", "mierdamail.com", "mintemail.com",
  "misterpinball.de", "mji.ro", "mjukglass.nu", "moakt.cc",
  "moakt.com", "moakt.co", "moakt.ws", "mockmyid.com",
  "momentics.ru", "moncourrier.fr.nf", "monemail.fr.nf",
  "monmail.fr.nf", "mt2009.com", "mt2014.com", "mx0.wwwnew.eu",
  "my10minutemail.com", "mymail-in.net", "mymailoasis.com",
  "mypartyclip.de", "myrealbox.com", "mytempemail.com",
  "mytempmail.com", "mytrashmail.com",
  "netmails.com", "netmails.net", "newtempmail.com",
  "nevermail.de", "nwldx.com",
  "objectmail.com", "odaymail.com", "oneoffemail.com", "oneoffmail.com",
  "onewaymail.com", "onlatedotcom.info", "online.ms",
  "otherinbox.com", "ourklips.com", "outlawspam.com",
  "owlpic.com",
  "pancakemail.com", "pimpedupmyspace.com", "pjjkp.com",
  "plexolan.de", "pookmail.com", "privacy.net", "proxymail.eu",
  "prtnx.com", "putthisinyourspamdatabase.com",
  "qisoa.com", "quickinbox.com",
  "rcpt.at", "recode.me", "recyclemail.dk", "regbypass.com",
  "rejectmail.com", "rklips.com", "rmqkr.net",
  "rppkn.com", "rtrtr.com",
  "s0ny.net", "safe-mail.net", "safetymail.info", "safetypost.de",
  "saynotospams.com", "schrott-email.de", "secretemail.de",
  "secure-mail.biz", "senseless-entertainment.com", "sharedmailbox.org",
  "shieldemail.com", "shiftmail.com", "shortmail.net",
  "sibmail.com", "skeefmail.com", "slapsfromlastnight.com",
  "slaskpost.se", "slopsbox.com", "slotmail.me",
  "smapfree24.com", "smapfree24.de", "smapfree24.eu",
  "smapfree24.info", "smapfree24.org", "smellfear.com",
  "snakemail.com", "sneakemail.com", "sneakmail.de",
  "sofimail.com", "sogetthis.com", "solopos.net",
  "spamcon.org", "spamcorptastic.com", "spamcowboy.com",
  "spamcowboy.net", "spamcowboy.org", "spamday.com",
  "spamdecoy.net", "spamex.com", "spamfree.eu", "spamgoes.in",
  "spamgourmet.com", "spamgourmet.net", "spamgourmet.org",
  "spamherelots.com", "spamhereplease.com",
  "spamhole.com", "spamify.com", "spaminator.de",
  "spamkill.info", "spaml.com", "spaml.de",
  "spammotel.com", "spamobox.com",
  "spamslicer.com", "spamspot.com", "spamstack.net",
  "spamthisplease.com", "spamtrail.com", "spamtroll.net",
  "speed.1s.fr", "spr.io", "squizzy.de", "squizzy.eu",
  "squizzy.net", "stinkefinger.net", "storemail.info",
  "stuffmail.de", "super-auswahl.de", "supergreatmail.com",
  "supermailer.jp", "superrito.com", "superstachel.de",
  "suremail.info", "sweetxxx.de",
  "techemail.com", "tefame.com", "teleworm.com", "teleworm.us",
  "tempalias.com", "tempe-mail.com", "tempemail.co.za",
  "tempemail.com", "tempemail.net", "tempi.email",
  "tempinbox.co.uk",
  "tempmail.it", "tempmail2.com", "tempmailer.com", "tempmailer.de",
  "tempomail.fr", "temporaryemail.net", "temporaryemail.us",
  "temporaryforwarding.com", "temporaryinbox.com",
  "thanksnospam.info", "thisisnotmyrealemail.com", "throwam.com",
  "throwaway.email", "tilien.com", "tittbit.in",
  "tmail.io", "tmailinator.com", "toiea.com",
  "tradermail.info", "trash-amil.com", "trash-mail.at",
  "trash-mail.com", "trash-mail.de", "trash-mail.ga",
  "trash-mail.io", "trash-mail.xyz", "trash2009.com",
  "trashemail.de", "trashimail.com",
  "trillianpro.com", "turual.com", "twinmail.de",
  "tyldd.com",
  "uggsrock.com", "uroid.com",
  "venompen.com", "veryrealemail.com", "viditag.com",
  "viewcastmedia.com", "viewcastmedia.net", "viewcastmedia.org",
  "vkcode.ru",
  "walkmail.net", "walkmail.ru", "webemail.me",
  "webm4il.info", "wegwerfmail.de", "wegwerfmail.net",
  "wegwerfmail.org", "wh4f.org", "whatpaas.com",
  "whopy.com", "wilemail.com", "willselfdestruct.com",
  "winemaven.info", "wronghead.com",
  "www.e4ward.com", "wwwnew.eu",
  "xagloo.co", "xagloo.com", "xemaps.com", "xents.com",
  "xmaily.com", "xoxy.net", "xww.ro",
  "yapped.net", "yep.it", "yogamaven.com",
  "yomail.info", "yopmail.pp.ua",
  "za.com", "zehnminuten.de", "zehnminuten.net", "zehnminutenmail.de",
  "zetmail.com", "zippymail.info", "zoaxe.com", "zoemail.net",
  "zoemail.org", "zomg.info",
]);

// ─── IP-based signup rate limiter ────────────────────────────────────────────
// Configurable via SIGNUP_RATE_LIMIT_PER_IP (default: 10 signups per hour).
// Whitelisted IPs bypass this check.
const _ipCounts = new Map<string, { count: number; windowStart: number }>();
const IP_RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour sliding window
const IP_RATE_LIMIT = parseInt(process.env.SIGNUP_RATE_LIMIT_PER_IP ?? "10", 10);

function checkIpRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = _ipCounts.get(ip);
  if (!entry || now - entry.windowStart > IP_RATE_WINDOW_MS) {
    _ipCounts.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= IP_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(key, { apiVersion: "2023-10-16" });
}

// POST /signup
router.post("/", async (req: Request, res: Response) => {
  const { email, tier = "free" } = req.body;

  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "email is required" });
  }

  const emailLower = email.toLowerCase().trim();

  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
    return res.status(400).json({ error: "Invalid email address" });
  }

  // ── Owner / tester whitelist — bypasses disposable-domain check ─────────────
  const clientIp =
    (req.headers["x-forwarded-for"] as string | undefined)
      ?.split(",")[0]
      .trim() ??
    req.ip ??
    "unknown";

  const WHITELISTED_EMAILS = new Set(["rsaun@gmail.com", "rsaunders612@gmail.com"]);
  const WHITELISTED_IPS    = new Set(["172.58.253.84"]);
  const isWhitelisted =
    WHITELISTED_EMAILS.has(emailLower) ||
    emailLower.endsWith("@security-orchestra.io") ||
    WHITELISTED_IPS.has(clientIp);

  // ── IP rate limit — whitelisted IPs bypass ───────────────────────────────────
  if (!isWhitelisted && !checkIpRateLimit(clientIp)) {
    return res.status(429).json({
      error: `Too many signups from this IP address. Limit: ${IP_RATE_LIMIT} per hour.`,
    });
  }

  // ── Reject disposable / throwaway email domains ──────────────────────────────
  if (!isWhitelisted) {
    const domain = emailLower.split("@")[1] ?? "";
    if (DISPOSABLE_DOMAINS.has(domain)) {
      return res.status(400).json({ error: "Disposable email addresses are not allowed." });
    }
  }

  // ── Internal test bypass ────────────────────────────────────────────────────
  // test@security-orchestra.io skips IP/disposable checks and returns the key
  // in the response body so the full flow can be verified without an email inbox.
  if (emailLower === "test@security-orchestra.io") {
    const testTierConfig = TIERS["free"];
    const existing = await dbGet<{ id: string }>(
      "SELECT id FROM users WHERE email = ?",
      [emailLower]
    );
    let testUserId: string;
    if (existing) {
      testUserId = existing.id;
    } else {
      testUserId = uuidv4();
      const now = new Date().toISOString();
      await dbRun(
        `INSERT INTO users (id, email, tier, created_at, ip_address, verification_status)
         VALUES (?, ?, 'free', ?, 'test-bypass', 'verified')`,
        [testUserId, emailLower, now]
      );
      await dbRun(
        "INSERT INTO credits (user_id, balance, total_purchased, total_used, updated_at) VALUES (?, ?, ?, 0, ?)",
        [testUserId, testTierConfig.credits, testTierConfig.credits, new Date().toISOString()]
      );
    }
    const apiKey = await provisionApiKey(testUserId, "free");
    if (!apiKey) {
      return res.status(500).json({ error: "Test bypass: failed to provision API key" });
    }
    return res.status(201).json({
      message: "Test bypass: API key provisioned",
      email: emailLower,
      tier: "free",
      apiKey,
    });
  }

  if (!TIERS[tier]) {
    return res.status(400).json({
      error: `Invalid tier. Options: ${Object.keys(TIERS).join(", ")}`,
    });
  }

  // Check for existing account
  const existing = await dbGet<{ id: string }>(
    "SELECT id FROM users WHERE email = ?",
    [emailLower]
  );
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  const userId = uuidv4();
  const now = new Date().toISOString();

  if (tier === "free") {
    const tierConfig = TIERS[tier];

    // Create verified user immediately — no email verification step
    await dbRun(
      `INSERT INTO users (id, email, tier, created_at, ip_address, verification_status)
       VALUES (?, ?, ?, ?, ?, 'verified')`,
      [userId, emailLower, tier, now, clientIp]
    );
    await dbRun(
      "INSERT INTO credits (user_id, balance, total_purchased, total_used, updated_at) VALUES (?, ?, ?, 0, ?)",
      [userId, tierConfig.credits, tierConfig.credits, now]
    );

    // Provision API key and send it directly
    const apiKey = await provisionApiKey(userId, tier);
    if (apiKey) {
      try {
        await sendApiKeyEmail(emailLower, apiKey, tierConfig.label);
      } catch (err) {
        console.error("[signup] API key email failed:", (err as Error).message);
      }
    } else {
      console.error(`[signup] Could not provision key for new free user ${userId}`);
    }

    // Notify internal team
    try {
      await sendSignupNotification(emailLower, tierConfig.label, tierConfig.credits, now);
    } catch (err) {
      console.error("[signup] Signup notification failed:", (err as Error).message);
    }

    return res.status(201).json({
      message: "Your API key has been sent to your email!",
      email: emailLower,
      tier,
    });
  }

  // Paid tier — create user record + Stripe checkout session
  const tierConfig = TIERS[tier];

  await dbRun(
    `INSERT INTO users (id, email, tier, created_at, ip_address, verification_status)
     VALUES (?, ?, 'free', ?, ?, 'pending')`,
    [userId, emailLower, now, clientIp]
  );
  await dbRun(
    "INSERT INTO credits (user_id, balance, total_purchased, total_used, updated_at) VALUES (?, 0, 0, 0, ?)",
    [userId, now]
  );

  try {
    const stripe = getStripe();
    const baseUrl = process.env.BASE_URL ?? "https://security-orchestra-billing.onrender.com";
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: tierConfig.price_cents,
            product_data: {
              name: `Security Orchestra — ${tierConfig.label} Plan`,
              description: `${tierConfig.credits.toLocaleString()} analysis credits`,
            },
          },
          quantity: 1,
        },
      ],
      customer_email: emailLower,
      metadata: { user_id: userId, tier },
      success_url: `${baseUrl}/signup-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/signup`,
    });

    return res.json({
      message: "Complete payment to activate your account",
      checkoutUrl: session.url,
      tier,
      credits: tierConfig.credits,
    });
  } catch (err) {
    console.error("[signup] Stripe error:", (err as Error).message);
    return res.status(500).json({ error: "Failed to create checkout session" });
  }
});

export default router;
