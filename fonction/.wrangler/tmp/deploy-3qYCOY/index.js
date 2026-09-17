var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// jwt.js
var encodeur = new TextEncoder();
function versB64url(octets) {
  let binaire = "";
  for (const octet of new Uint8Array(octets)) binaire += String.fromCharCode(octet);
  return btoa(binaire).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(versB64url, "versB64url");
function depuisB64url(texte) {
  const binaire = atob(String(texte).replace(/-/g, "+").replace(/_/g, "/"));
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return octets;
}
__name(depuisB64url, "depuisB64url");
var texteVersB64url = /* @__PURE__ */ __name((texte) => versB64url(encodeur.encode(texte)), "texteVersB64url");
var secretEnOctets = /* @__PURE__ */ __name((secretB64) => depuisB64url(String(secretB64).replace(/=+$/, "")), "secretEnOctets");
async function cleHmac(secretB64, usages) {
  return crypto.subtle.importKey(
    "raw",
    secretEnOctets(secretB64),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages
  );
}
__name(cleHmac, "cleHmac");
async function signer(charge, secretB64, dureeSecondes = 120) {
  const entete = texteVersB64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const corps = texteVersB64url(JSON.stringify({
    ...charge,
    exp: Math.floor(Date.now() / 1e3) + dureeSecondes
  }));
  const cle = await cleHmac(secretB64, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cle, encodeur.encode(`${entete}.${corps}`));
  return `${entete}.${corps}.${versB64url(signature)}`;
}
__name(signer, "signer");
async function verifier(jeton, secretB64) {
  const morceaux = String(jeton || "").split(".");
  if (morceaux.length !== 3) return null;
  const [entete, corps, signature] = morceaux;
  const cle = await cleHmac(secretB64, ["verify"]);
  let valide = false;
  try {
    valide = await crypto.subtle.verify(
      "HMAC",
      cle,
      depuisB64url(signature),
      encodeur.encode(`${entete}.${corps}`)
    );
  } catch {
    return null;
  }
  if (!valide) return null;
  let charge;
  try {
    charge = JSON.parse(new TextDecoder().decode(depuisB64url(corps)));
  } catch {
    return null;
  }
  if (typeof charge.exp === "number" && charge.exp < Math.floor(Date.now() / 1e3)) return null;
  return charge;
}
__name(verifier, "verifier");
function jetonDeDiffusion(canal, proprietaire, secretB64) {
  return signer({
    user_id: String(proprietaire),
    role: "external",
    channel_id: String(canal),
    pubsub_perms: { send: ["broadcast"] }
  }, secretB64);
}
__name(jetonDeDiffusion, "jetonDeDiffusion");
var messageDAppairage = /* @__PURE__ */ __name((canal) => encodeur.encode(`appairage:${canal}`), "messageDAppairage");
async function jetonDAppairage(canal, secretB64) {
  const cle = await cleHmac(secretB64, ["sign"]);
  return versB64url(await crypto.subtle.sign("HMAC", cle, messageDAppairage(canal)));
}
__name(jetonDAppairage, "jetonDAppairage");
async function appairageValide(canal, jeton, secretB64) {
  if (!canal || !jeton) return false;
  const cle = await cleHmac(secretB64, ["verify"]);
  try {
    return await crypto.subtle.verify("HMAC", cle, depuisB64url(jeton), messageDAppairage(canal));
  } catch {
    return false;
  }
}
__name(appairageValide, "appairageValide");

// index.js
var API_PUBSUB = "https://api.twitch.tv/helix/extensions/pubsub";
var TAILLE_MAX = 5 * 1024;
var ENTETES = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-max-age": "86400"
};
var repondre = /* @__PURE__ */ __name((corps, code = 200) => new Response(JSON.stringify(corps), {
  status: code,
  headers: { ...ENTETES, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
}), "repondre");
var porteur = /* @__PURE__ */ __name((requete) => String(requete.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""), "porteur");
async function diffuser(canal, message, env) {
  const jeton = await jetonDeDiffusion(canal, env.EXT_PROPRIETAIRE, env.EXT_SECRET);
  const reponse = await fetch(API_PUBSUB, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jeton}`,
      "client-id": env.EXT_CLIENT_ID,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      target: ["broadcast"],
      broadcaster_id: String(canal),
      is_global_broadcast: false,
      message
    })
  });
  if (!reponse.ok) {
    throw new Error(`Twitch a refus\xE9 : HTTP ${reponse.status} ${await reponse.text()}`);
  }
}
__name(diffuser, "diffuser");
async function appairage(requete, env) {
  const identite = await verifier(porteur(requete), env.EXT_SECRET);
  if (!identite || identite.role !== "broadcaster" || !identite.channel_id) {
    return repondre({ erreur: "r\xE9serv\xE9 au diffuseur" }, 403);
  }
  const canal = String(identite.channel_id);
  const jeton = await jetonDAppairage(canal, env.EXT_SECRET);
  const code = texteVersB64url(JSON.stringify({
    e: env.EBS_PUBLIQUE || new URL(requete.url).origin,
    c: canal,
    j: jeton
  }));
  return repondre({ canal, jeton, code });
}
__name(appairage, "appairage");
async function publier(requete, env) {
  const canal = String(requete.headers.get("x-canal") || "");
  if (!await appairageValide(canal, porteur(requete), env.EXT_SECRET)) {
    return repondre({ erreur: "appairage invalide" }, 401);
  }
  const message = await requete.text();
  if (message.length > TAILLE_MAX) {
    return repondre({ erreur: `message de ${message.length} octets : au-dessus des 5 Ko` }, 413);
  }
  try {
    JSON.parse(message);
  } catch {
    return repondre({ erreur: "charge utile illisible" }, 400);
  }
  try {
    await diffuser(canal, message, env);
  } catch (err) {
    return repondre({ erreur: err.message }, 502);
  }
  return repondre({ ok: true });
}
__name(publier, "publier");
async function router(requete, env) {
  const url = new URL(requete.url);
  if (requete.method === "OPTIONS") return new Response(null, { status: 204, headers: ENTETES });
  if (requete.method === "GET" && url.pathname === "/appairage") return appairage(requete, env);
  if (requete.method === "POST" && url.pathname === "/publier") return publier(requete, env);
  if (requete.method === "GET" && url.pathname === "/") {
    return repondre({ service: "hots-twitch-talents", etat: "en marche" });
  }
  return repondre({ erreur: "inconnu" }, 404);
}
__name(router, "router");
var index_default = {
  fetch: /* @__PURE__ */ __name((requete, env) => router(requete, env), "fetch")
};
export {
  index_default as default,
  router
};
//# sourceMappingURL=index.js.map
