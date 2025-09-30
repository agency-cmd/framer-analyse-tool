// /api/analyze.ts - v4.1 (final) mit korrekter HTML-Extraktion für maximale Qualität
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

// --- DATENERFASSUNG (KORRIGIERT: BEHÄLT <HEAD> UND <BODY>) ---
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

        // Entferne Skripte und Styles aus dem gesamten Dokument
        $('script, style, noscript').remove();
        
        // --- START DER KORREKTUR ---
        // Statt nur den body-Inhalt zu nehmen, nehmen wir das gesamte, bereinigte HTML.
        // Das bewahrt <head>, <title>, <meta>-Tags UND den <body>.
        const fullCleanedHtml = $.html() || '';
        // --- ENDE DER KORREKTUR ---
        
        const condensedHtml = fullCleanedHtml.replace(/\s+/g, ' ').trim();
        
        // Limit leicht erhöht, um sicherzustellen, dass alles Platz hat
        return condensedHtml.substring(0, 40000);

    } catch (error) {
        console.error(`Fehler beim Abrufen der URL ${url} via Browserless:`, error);
        throw new Error("Die Webseite konnte nicht vollständig geladen werden.");
    }
}

// --- API-HANDLER (unverändert) ---
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

    const cacheKey = `cro-analysis-v4.1:${url}`;
    try {
        const cachedResult = await kv.get<any>(cacheKey);
        if (cachedResult) { return res.status(200).json(cachedResult); }
    } catch (error) { console.error("Vercel KV Cache-Fehler (Lesen):", error); }

    try {
        const pageContent = await getCleanedPageContent(url);
        
        const prompt = `
            Du bist ein Weltklasse Conversion-Optimierer. Deine Aufgabe ist es, den folgenden HTML-Code einer Webseite wie ein menschlicher Auditor zu prüfen.
            Du musst aktiv nach Problemen suchen und insbesondere das Fehlen von wichtigen Elementen als kritischen Fehler bewerten.

            DEIN PRÜFAUFTRAG (Checkliste nach Wichtigkeit):
            1.  **Unklare Value Proposition:** Finde das \`<h1>\`-Element. Ist sein Text vage, voller Jargon oder erklärt er keinen klaren Nutzen für den Kunden? (z.B. "Willkommen" oder "Das neue Agile"). Wenn ja, ist das ein Killer.
            2.  **Schwacher oder fehlender Call-to-Action (CTA):** Durchsuche den Code nach prominenten Buttons (\`<button>\`, \`<a>\` mit Button-Klassen). Gibt es im oberen Seitenbereich einen klaren, aktiven Handlungsaufruf (z.B. "Jetzt starten")? Wenn gar kein klarer CTA zu finden ist, ist das ein SEHR KRITISCHER Killer. Passive Texte wie "Mehr erfahren" sind ebenfalls ein Killer.
            3.  **Fehlende Vertrauenssignale:** Durchsuche den gesamten Text. Findest du Wörter wie "Kundenstimmen", "Bewertungen", "Partner", "Garantie", "Zertifikat"? Gibt es \`<img>\`-Tags, die auf Kundenlogos hindeuten? Wenn solche Signale komplett fehlen, ist das ein schwerwiegender Killer.
            4.  **Zu viele Ablenkungen:** Gibt es ein \`<nav>\`-Element mit vielen Links (z.B. mehr als 3-4)? Gibt es Links zu Social Media oder zum "Blog"? Wenn ja, lenken diese vom Hauptziel ab und sind ein Killer.
            5.  **Fehlende mobile Optimierung:** Gibt es ein \`<meta name="viewport">\`-Tag im \`<head>\`-Bereich? Wenn es fehlt, ist die Seite wahrscheinlich nicht für Mobilgeräte optimiert. Das ist ein Killer.
            6.  **"Message Match"-Fehler:** Finde das \`<title>\`-Tag. Weicht der Titel stark von der Botschaft des \`<h1>\`-Tags ab? Wenn ja, ist das ein Killer.
            7.  **Komplexes Formular:** Wenn du ein \`<form>\`-Element findest, zähle die \`<input>\`-Felder. Sind es mehr als 4-5? Dann ist das ein Killer.
            8.  Weitere Killer wie **technische Fehler** (leere Links), **schlechte Lesbarkeit** (sehr lange \`<p>\`-Tags ohne Formatierung) oder **aufdringliche Pop-ups** (Texte wie "Angebot nicht verpassen") solltest du ebenfalls identifizieren.

            DEINE AUFGABE & REGELN:
            - Führe den Prüfauftrag aus. Identifiziere ALLE zutreffenden Probleme.
            - Zähle die Gesamtzahl und wähle die TOP 2 gravierendsten aus.
            - Titel aus Nutzersicht.
            - Detailbeschreibung (max. 25 Wörter) muss das Problem erklären, ein Zitat/Beispiel aus dem Code enthalten und den negativen Effekt aufzeigen. Zitiere auch, wenn etwas fehlt (z.B. "Es wurde kein primärer CTA-Button gefunden.").
            - Antwort nur als JSON.

            ZU PRÜFENDER HTML-CODE:
            \`\`\`html
            ${pageContent}
            \`\`\`
        `;
        
        const apiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });

        if (!apiResponse.ok) {
            const errorBody = await apiResponse.text();
            console.error("Fehler von der Gemini API:", errorBody);
            throw new Error("Die KI-Analyse konnte nicht durchgeführt werden.");
        }
        
        const responseData = await apiResponse.json();
        if (!responseData.candidates?.[0]?.content?.parts?.[0]?.text) {
             throw new Error("Unerwartetes Format der KI-Antwort erhalten.");
        }
        const responseText = responseData.candidates[0].content.parts[0].text;
        
        let analysisResult;
        try {
            const cleanedJsonString = responseText.match(/\{[\s\S]*\}/)[0];
            analysisResult = JSON.parse(cleanedJsonString);
        } catch (e) {
            console.error("Fehler beim Parsen der KI-Antwort:", responseText);
            throw new Error("Die Antwort der KI hatte ein ungültiges Format.");
        }
        
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
