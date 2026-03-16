// /api/analyze.ts - v5.4 mit vollständigem Logging aller Killer
import { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';
import * as cheerio from 'cheerio';

// --- UMWELTSVARIABLEN ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BROWSERLESS_API_KEY = process.env.BROWSERLESS_API_KEY;

if (!GEMINI_API_KEY || !BROWSERLESS_API_KEY) {
    throw new Error("Erforderliche Umgebungsvariablen sind nicht gesetzt.");
}
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// --- DATENERFASSUNG (BEHÄLT <HEAD> UND <BODY>) ---
async function getCleanedPageContent(url: string): Promise<string> {
    try {
        const browserlessUrl = `https://production-sfo.browserless.io/content?token=${BROWSERLESS_API_KEY}`;
        const response = await fetch(browserlessUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url }),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Browserless API Fehler! Status: ${response.status}. Details: ${errorText}`);
        }
        const html = await response.text();
        const $ = cheerio.load(html);
        $('script, style, noscript').remove();
        const fullCleanedHtml = $.html() || '';
        const condensedHtml = fullCleanedHtml.replace(/\s+/g, ' ').trim();
        return condensedHtml.substring(0, 40000);
    } catch (error) {
        console.error(`Fehler beim Abrufen der URL ${url} via Browserless:`, error);
        throw new Error("Die Webseite konnte nicht vollständig geladen werden.");
    }
}

// --- API-HANDLER ---
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { return res.status(200).end(); }
    if (req.method !== 'POST') { return res.status(405).json({ message: 'Methode nicht erlaubt.' }); }

    let { url } = req.body;
    if (typeof url !== 'string' || !url.trim()) { return res.status(400).json({ message: 'Bitte gib eine URL ein.' }); }
    if (!url.startsWith('http')) { url = 'https://' + url; }
    try { new URL(url); } catch (_) { return res.status(400).json({ message: 'Das Format der URL ist ungültig.' }); }

    if (url.includes('luqy.studio')) {
        return res.status(200).json({ isSpecialCase: true, specialNote: "Diese Landing Page ist offensichtlich eine 10/10. 😉 Bereit für deine eigene?" });
    }

    const cacheKey = `cro-analysis-v5.4:${url}`; // Version erhöht
    try {
        const cachedResult = await kv.get<any>(cacheKey);
        if (cachedResult) { return res.status(200).json(cachedResult); }
    } catch (error) { console.error("Vercel KV Cache-Fehler (Lesen):", error); }

    try {
        const pageContent = await getCleanedPageContent(url);

        const prompt = `
            Du bist ein kompromissloser Inbound-Funnel-Architekt und UX-Experte für B2B-Leadgenerierung. Deine Aufgabe ist es, den HTML-Code wie ein menschlicher Auditor zu prüfen. Dein einziger Fokus: Warum verwandelt diese Seite teuren High-Intent-Traffic aus Google Ads nicht nahtlos in gebuchte Termine?
            
            DEIN PRÜFAUFTRAG:
            1.  Prüfe den HTML-Code anhand der 12-Punkte-Checkliste auf Conversion-Killer und Termin-Blocker.
            2.  Identifiziere **ALLE** zutreffenden Probleme.
            3.  Wähle aus allen gefundenen Problemen die **ZWEI gravierendsten** aus, die den Termin-Flow am stärksten zerstören.
            4.  Zähle die Gesamtzahl aller Probleme.
            5.  Rufe das Werkzeug 'reportConversionKillers' auf und übergib die Ergebnisse. Fülle dabei **beide** Felder: 'allKillers' mit der kompletten Liste und 'topKillers' nur mit den zwei wichtigsten.

            Checkliste (Fokus auf Terminbuchung, UX & High-Intent-Traffic):
            1.  **Ablenkungs-Falle (Leaks):** Gibt es eine \`<nav>\`-Leiste oder ausgehende Links? Ein echter Termin-Funnel hat keine Navigation. Der User darf nicht zum Stöbern (\"Über uns\", \"Blog\") verleitet werden.
            2.  **Veralteter Kontakt-Weg:** Nutzt die Seite ein klassisches \`<form>\` (Kontaktformular) anstatt auf eine nahtlose, direkte Kalender-Buchung (z.B. Zeeg) zu setzen? Das kostet sofort 50% der B2B-Leads.
            3.  **Schwaches Angebot / Ad-Message-Mismatch:** Ist die \`<h1>\` vage oder weicht vom \`<title>\` ab? Holt sie B2B-Entscheider nicht mit einem messerscharfen, sofortigen Nutzen ab?
            4.  **Fehlender Buchungs-Fokus:** Fehlt ein klarer, aktiver \"Termin buchen\" CTA-Button im sofort sichtbaren Bereich?
            5.  **Fehlender Ablauf (Blackbox):** Fehlt eine Sektion, die glasklar erklärt, was im oder nach dem Deep-Dive-Call passiert (Suche nach \"Schritt\", \"Ablauf\", \"So funktioniert's\")?
            6.  **Gesichtslose Experience:** Fehlt die persönliche, authentische Ebene für High-Ticket-Trust? (Fehlen Wörter wie \"Ich\", \"Persönlich\", Gründer-Präsenz)?
            7.  **Fehlender Trust / Social Proof:** Fehlen Kundenstimmen, Logos, Case Studies oder messbare Resultate?
            8.  **Text-Wüsten:** Gibt es extrem lange, unstrukturierte Textblöcke (\`<p>\`), die mobile Nutzer sofort abschrecken?
            9.  **Pop-up Interruption:** Gibt es Overlays oder Pop-ups, die den nahtlosen Flow zur Terminbuchung aggressiv unterbrechen?
            10. **Zu wenig Buchungs-Chancen:** Gibt es auf der gesamten Seite zu wenige Call-to-Actions? Ein starker Funnel fordert nach jedem logischen Sinnabschnitt zur Buchung auf.
            11. **Reibungsverluste (Technik):** Gibt es Hinweise auf kaputte Bilder (\`src=\"\"\`) oder fehlerhafte Links (\`href=\"\"\`)?
            12. **Fehlende mobile Experience:** Fehlt das \`<meta name=\"viewport\">\`-Tag oder mobile CSS-Klassen (\"sm:\", \"md:\")?

            REGELN FÜR DIE DETAILBESCHREIBUNG:
            - **STRIKTES LIMIT: MAXIMAL 10 WÖRTER!**
            - Muss das Problem aus Nutzersicht benennen und extrem pragmatisch sein.
            - Verzichte komplett auf technische HTML-Begriffe (kein \"h1\", \"nav\", \"href\").
            - Verzichte auf Feedback zum Cookie-Banner.
            - Priorisiere deine Ausgabe in exakt dieser Reihenfolge (die schlimmsten Termin-Blocker zuerst): 1., 2., 4., 3., 5., 6., 7., 10., 8., 9., 11., 12.
            
            ZU PRÜFENDER HTML-CODE:
            \`\`\`html
            ${pageContent}
            \`\`\`

        
        `;

        const tools = [{
            function_declarations: [{
                name: "reportConversionKillers",
                description: "Übermittelt die gefundenen Conversion-Killer einer Webseiten-Analyse.",
                parameters: {
                    type: "OBJECT",
                    required: ["totalFound", "topKillers", "allKillers"], // allKillers ist jetzt erforderlich
                    properties: {
                        totalFound: { type: "NUMBER", description: "Die Gesamtzahl aller gefundenen Conversion-Killer." },
                        topKillers: {
                            type: "ARRAY",
                            description: "Eine Liste der Top 2 gravierendsten Conversion-Killer.",
                            items: { /* ... (unverändert) ... */ }
                        },
                        // --- START DER ÄNDERUNG ---
                        allKillers: {
                            type: "ARRAY",
                            description: "Eine vollständige Liste aller gefundenen Conversion-Killer.",
                            items: {
                                type: "OBJECT",
                                required: ["title", "detail"],
                                properties: {
                                    title: { type: "STRING" },
                                    detail: { type: "STRING" }
                                }
                            }
                        }
                        // --- ENDE DER ÄNDERUNG ---
                    }
                }
            }]
        }];

        const apiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                tools: tools,
            }),
        });

        if (!apiResponse.ok) {
            const errorBody = await apiResponse.text();
            console.error("Fehler von der Gemini API:", errorBody);
            throw new Error("Die KI-Analyse konnte nicht durchgeführt werden.");
        }

        const responseData = await apiResponse.json();
        const functionCall = responseData.candidates?.[0]?.content?.parts?.[0]?.functionCall;

        if (!functionCall || functionCall.name !== 'reportConversionKillers') {
            // ... (Fallback, falls keine Killer gefunden)
        }

        const analysisResult = functionCall.args;

        const totalFound = analysisResult.totalFound || 0;
        if (totalFound === 0) {
            // ... (Logik für "keine Killer")
        }

        const topKillers = analysisResult.topKillers || [];
        let topKillersToShow = [];
        let message = "";

        if (totalFound < 4) {
            topKillersToShow = topKillers.slice(0, 1);
            message = `Auf ${new URL(url).hostname} wurden ${totalFound} potenzieller Conversion-Killer gefunden:`;
        } else {
            topKillersToShow = topKillers.slice(0, 2);
            message = `Auf ${new URL(url).hostname} wurden ${totalFound} potenzielle Conversion-Killer gefunden:`;
        }

        const finalResultForUser = {
            message,
            topKillers: topKillersToShow,
            remainingKillers: Math.max(0, totalFound - topKillersToShow.length)
        };
        
        // --- START DER ÄNDERUNG ---
        // Speichere das Ergebnis für den Nutzer im Cache
        await kv.set(cacheKey, finalResultForUser, { ex: 259200 });

        // Speichere den vollständigen Datensatz für dich im Log
        await kv.set(`log:${new Date().toISOString()}:${url}`, {
            url,
            totalFound,
            allKillers: analysisResult.allKillers || [], // Speichert die komplette Liste
        });
        // --- ENDE DER ÄNDERUNG ---

        return res.status(200).json(finalResultForUser);

    } catch (error) {
        console.error("Allgemeiner Fehler im API-Handler:", error);
        return res.status(500).json({ message: error.message || "Ein interner Serverfehler ist aufgetreten." });
    }
}
