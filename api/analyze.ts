// /api/analyze.ts - v5.0 (final) mit "Function Calling" für maximale Zuverlässigkeit
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

    const cacheKey = `cro-analysis-v5.0:${url}`;
    try {
        const cachedResult = await kv.get<any>(cacheKey);
        if (cachedResult) { return res.status(200).json(cachedResult); }
    } catch (error) { console.error("Vercel KV Cache-Fehler (Lesen):", error); }

    try {
        const pageContent = await getCleanedPageContent(url);
        
        // --- START: NEUER ANSATZ MIT "FUNCTION CALLING" ---
        const prompt = `
            Du bist ein Weltklasse Conversion-Optimierer. Deine Aufgabe ist es, den folgenden HTML-Code einer Webseite wie ein menschlicher Auditor zu prüfen.
            Du musst aktiv nach Problemen suchen und insbesondere das Fehlen von wichtigen Elementen als kritischen Fehler bewerten.

            DEIN PRÜFAUFTRAG:
            Prüfe den HTML-Code anhand der folgenden Checkliste. Identifiziere ALLE zutreffenden Probleme, zähle sie und merke dir die ZWEI gravierendsten.

            Checkliste:
            1.  **Unklare Value Proposition:** Ist der \`<h1>\`-Text vage oder voller Jargon?
            2.  **Fehlender/Schwacher CTA:** Fehlt ein klarer, aktiver Call-to-Action Button im oberen Bereich? Sind Button-Texte passiv?
            3.  **Fehlende Vertrauenssignale:** Fehlen Wörter wie "Kundenstimmen", "Bewertungen", "Partner" oder Kundenlogos?
            4.  **Zu viele Ablenkungen:** Gibt es eine \`<nav>\`-Leiste mit zu vielen Links, die vom Ziel ablenken?
            5.  **Fehlende mobile Optimierung:** Fehlt das \`<meta name="viewport">\`-Tag im \`<head>\`-Bereich?
            6.  **"Message Match"-Fehler:** Weicht der \`<title>\` stark von der \`<h1>\`-Botschaft ab?
            7.  **Komplexes Formular:** Hat ein \`<form>\`-Element mehr als 4-5 \`<input>\`-Felder?
            8.  Weitere Probleme wie technische Fehler, schlechte Lesbarkeit etc.

            NACH DEINER ANALYSE:
            Rufe zwingend das Werkzeug 'reportConversionKillers' auf, um deine Ergebnisse zu übermitteln. Formuliere die Titel aus Nutzersicht und die Detailbeschreibung (max. 25 Wörter) mit einem Zitat/Beispiel und dem negativen Effekt.

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
                                    detail: { type: "STRING", description: "Die Detailbeschreibung (max. 25 Wörter) mit Zitat und negativem Effekt." }
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
            throw new Error("Die KI konnte keine strukturierte Analyse liefern.");
        }
        
        const analysisResult = functionCall.args;
        // --- ENDE: NEUER ANSATZ ---
        
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
            message = `Gute Nachrichten! Auf ${new URL(url).hostname} wurde nur ${totalFound} ${killerWord} gefunden. Der wichtigste ist:`;
        } else {
            topKillersToShow = topKillers.slice(0, 2);
            message = `Analyse abgeschlossen. Auf ${new URL(url).hostname} wurden ${totalFound} potenzielle Conversion-Killer identifiziert. Die gravierendsten sind:`;
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
