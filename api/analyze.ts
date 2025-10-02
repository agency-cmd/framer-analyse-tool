// /api/analyze.ts - v5.3 mit intelligenterer Mobile-Optimierungs-Prüfung

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

        return res.status(200).json({ isSpecialCase: true, specialNote: "Diese Landing Page ist offensichtlich perfekt. 😉 Bereit für deine eigene?" });

    }



    const cacheKey = `cro-analysis-v5.3:${url}`;

    try {

        const cachedResult = await kv.get<any>(cacheKey);

        if (cachedResult) { return res.status(200).json(cachedResult); }

    } catch (error) { console.error("Vercel KV Cache-Fehler (Lesen):", error); }



    try {

        const pageContent = await getCleanedPageContent(url);

        

        // --- START: PROMPT MIT VERBESSERTER MOBILE-PRÜFUNG ---

        const prompt = `

            Du bist ein Weltklasse Conversion-Optimierer. Deine Aufgabe ist es, den HTML-Code wie ein menschlicher Auditor zu prüfen und dabei aktiv nach Problemen zu suchen, insbesondere nach fehlenden Elementen.



            DEIN PRÜFAUFTRAG:

            Prüfe den HTML-Code anhand der folgenden 11-Punkte-Checkliste. Identifiziere ALLE zutreffenden Probleme, zähle sie und merke dir die ZWEI gravierendsten.



            Checkliste:

            1.  **Langsame Ladezeit:** Suche nach Indikatoren für eine langsame Seite (z.B. ungewöhnlich viele \`<img>\`- oder \`<script>\`-Tags).

            2.  **Fehlende mobile Optimierung:** Ein fehlendes \`<meta name="viewport">\`-Tag ist ein starkes Warnsignal. Melde diesen Fehler aber nur, wenn du auch sonst keine Hinweise auf ein responsives Design findest (z.B. CSS-Klassen mit "mobile", "sm:", "md:", "lg:").

            3.  **Unklare Value Proposition:** Ist der \`<h1>\`-Text vage, voller Jargon oder erklärt er keinen klaren Kundennutzen?

            4.  **"Message Match"-Fehler:** Weicht der \`<title>\` stark von der \`<h1>\`-Botschaft ab?

            5.  **Fehlender/Schwacher CTA:** Fehlt ein klarer, aktiver Call-to-Action Button im oberen Bereich? Sind Button-Texte passiv?

            6.  **Offensichtliche technische Fehler:** Gibt es Hinweise auf kaputte Bilder (\`src=""\`) oder fehlerhafte Links (\`href=""\`)?

            7.  **Fehlende Vertrauenssignale:** Fehlen Wörter wie "Kundenstimmen", "Bewertungen", "Partner" oder Kundenlogos?

            8.  **Zu viele Ablenkungen:** Gibt es eine \`<nav>\`-Leiste mit zu vielen ablenkenden Links (mehr als 4)?

            9.  **Komplexes Formular:** Hat ein \`<form>\`-Element mehr als 4-5 \`<input>\`-Felder?

            10. **Schlechte Lesbarkeit:** Gibt es extrem lange Textblöcke in \`<p>\`-Tags ohne Absätze/Formatierung?

            11. **Aufdringliche Pop-ups:** Gibt es Hinweise auf sofortige Overlays (z.B. Elemente mit Texten wie "Angebot nicht verpassen")?



            NACH DEINER ANALYSE:

            Rufe zwingend das Werkzeug 'reportConversionKillers' auf, um deine Ergebnisse zu übermitteln.



            REGELN FÜR DIE DETAILBESCHREIBUNG:

            - **STRIKTES LIMIT: MAXIMAL 10 WÖRTER!**

            - Muss das Problem kurz benennen und ein Zitat/Beispiel enthalten, ohne zu technisch zu werden.

            - Titel müssen aus Nutzersicht formuliert sein.



            ZU PRÜFENDER HTML-CODE:

            \`\`\`html

            ${pageContent}

            \`\`\`

        `;

        // --- ENDE: PROMPT MIT VERBESSERTER MOBILE-PRÜFUNG ---



        const tools = [{

            function_declarations: [{

                name: "reportConversionKillers",

                description: "Übermittelt die gefundenen Conversion-Killer einer Webseiten-Analyse.",

                parameters: {

                    type: "OBJECT",

                    required: ["totalFound", "topKillers"],

                    properties: {

                        totalFound: { type: "NUMBER", description: "Die Gesamtzahl aller gefundenen Conversion-Killer." },

                        topKillers: {

                            type: "ARRAY",

                            description: "Eine Liste der Top 2 gravierendsten Conversion-Killer.",

                            items: {

                                type: "OBJECT",

                                required: ["title", "detail"],

                                properties: {

                                    title: { type: "STRING", description: "Der nutzerfreundliche Titel des Problems." },

                                    detail: { type: "STRING", description: "Die SEHR KURZE Detailbeschreibung (maximal 10 Wörter) mit Zitat." }

                                }

                            }

                        }

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

            console.error("KI hat nicht das erwartete Werkzeug aufgerufen:", responseData);

            if (!functionCall) {

                 const result = { isSpecialCase: true, specialNote: `Glückwunsch! Auf ${new URL(url).hostname} wurden keine gravierenden Conversion-Killer gefunden.` };

                 await kv.set(cacheKey, result, { ex: 259200 });

                 return res.status(200).json(result);

            }

            throw new Error("Die KI konnte keine strukturierte Analyse liefern.");

        }

        

        const analysisResult = functionCall.args;

        

        const totalFound = analysisResult.totalFound || 0;

        if (totalFound === 0) {

            const result = { isSpecialCase: true, specialNote: `Glückwunsch! Auf ${new URL(url).hostname} wurden keine gravierenden Conversion-Killer gefunden.` };

            await kv.set(cacheKey, result, { ex: 259200 });

            return res.status(200).json(result);

        }

        

        const topKillers = analysisResult.topKillers || [];

        let topKillersToShow = [];

        let message = "";

        

        if (totalFound < 4) {

            topKillersToShow = topKillers.slice(0, 1);

            const killerWord = totalFound === 1 ? 'potenzieller Conversion-Killer' : 'potenzielle Conversion-Killer';

            message = `Gute Nachrichten! Auf ${new URL(url).hostname} wurde nur ${totalFound} ${killerWord} gefunden:`;

        } else {

            topKillersToShow = topKillers.slice(0, 2);

            message = `Auf ${new URL(url).hostname} wurden ${totalFound} potenzielle Conversion-Killer identifiziert:`;

        }

        

        const finalResult = { message, topKillers: topKillersToShow, remainingKillers: Math.max(0, totalFound - topKillersToShow.length) };

        

        await kv.set(cacheKey, finalResult, { ex: 259200 });

        await kv.set(`log:${new Date().toISOString()}:${url}`, { url, result: finalResult });

        

        return res.status(200).json(finalResult);



    } catch (error) {

        console.error("Allgemeiner Fehler im API-Handler:", error);

        return res.status(500).json({ message: error.message || "Ein interner Serverfehler ist aufgetreten." });

    }

}
