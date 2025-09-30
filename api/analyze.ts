// /api/analyze.ts
import { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';
import * as cheerio from 'cheerio';

// --- UMWELTSVARIABLEN ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY ist nicht in den Umgebungsvariablen gesetzt.");
}
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// --- DATENERFASSUNG & -BEREINIGUNG (VERBESSERT) ---
async function getCleanedPageContent(url: string): Promise<string> {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        if (!response.ok) {
            throw new Error(`HTTP-Fehler! Status: ${response.status}`);
        }
        const html = await response.text();
        const $ = cheerio.load(html);

        // Entferne nicht relevante Teile, aber behalte die HTML-Struktur
        $('script, style, noscript, svg, footer, nav').remove();

        // Extrahiere den Body und kürze ihn intelligent
        const bodyHtml = $('body').html() || '';
        
        // Reduziere Whitespace, um mehr relevanten Inhalt zu behalten
        const condensedHtml = bodyHtml.replace(/\s+/g, ' ').trim();
        
        return condensedHtml.substring(0, 20000);
    } catch (error) {
        console.error(`Fehler beim Abrufen oder Parsen der URL ${url}:`, error);
        throw new Error("Die Webseite konnte nicht analysiert werden. Ist die URL korrekt und öffentlich zugänglich?");
    }
}


// --- API-HANDLER ---
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // CORS Header für Framer-Kommunikation
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Methode nicht erlaubt. Nur POST-Anfragen sind zulässig.' });
    }

    // --- INPUT-VALIDIERUNG ---
    let { url } = req.body;
    if (typeof url !== 'string' || url.trim() === '') {
        return res.status(400).json({ message: 'Bitte gib eine URL ein.' });
    }
    if (!url.startsWith('http')) {
        url = 'https://' + url;
    }
    try {
        new URL(url);
    } catch (_) {
        return res.status(400).json({ message: 'Das Format der URL ist ungültig.' });
    }

    // --- SONDERFALL 1: EIGENE DOMAIN ---
    if (url.includes('luqy.studio')) {
        return res.status(200).json({ isSpecialCase: true, specialNote: "Diese Landing Page ist offensichtlich perfekt. 😉 Bereit für deine eigene?" });
    }

    // --- CACHING ---
    const cacheKey = `cro-analysis-v2:${url}`;
    try {
        const cachedResult = await kv.get<any>(cacheKey);
        if (cachedResult) {
            return res.status(200).json(cachedResult);
        }
    } catch (error) {
        console.error("Vercel KV Cache-Fehler (Lesen):", error);
        // Kein Abbruch, fahre ohne Cache fort
    }

    try {
        // --- HAUPTLOGIK: ANALYSE ---
        const pageContent = await getCleanedPageContent(url);
        
        const prompt = `
            Du bist ein Weltklasse Conversion-Optimierer. Deine Aufgabe ist es, den folgenden HTML-Auszug einer Webseite zu analysieren.
            
            ANALYSE-CHECKLISTE (Deine Wissensbasis):
            1.  **Ladezeit-Indikatoren:** Suche nach Hinweisen auf langsame Ladezeiten (z.B. viele große Bilder, exzessive Skripte).
            2.  **Mobile Optimierung:** Prüfe auf das Fehlen eines Viewport-Meta-Tags oder starre Breitenangaben.
            3.  **Unklare Value Proposition:** Ist die H1-Überschrift spezifisch und nutzerorientiert oder vage wie "Willkommen"?
            4.  **Schwacher Call-to-Action (CTA):** Sind Button-Texte handlungsorientiert (z.B. "Jetzt Guide herunterladen") oder passiv (z.B. "Mehr")?
            5.  **Aufdringliche Elemente:** Gibt es Hinweise auf sofortige Pop-ups oder Overlays?
            6.  **Fehlende Vertrauenssignale:** Suche nach Keywords wie "Kundenstimmen", "Garantie", "Sicher", "Zertifikat" oder Links zu Datenschutz/Impressum.
            7.  **Komplexe Formulare:** Analysiere <form>-Elemente. Sind dort mehr als 4-5 <input>-Felder für einen einfachen Lead?
            8.  **Schlechte Lesbarkeit:** Achte auf "Walls of Text" (lange Absätze ohne Formatierung).
            9.  **Technische Fehler-Indikatoren:** Suche nach leeren 'src' oder 'href' Attributen in <img> oder <a> Tags.
            10. **Message Match Fehler:** Vergleiche den Seitentitel (<title>) mit der Hauptüberschrift (<h1>). Gibt es eine Diskrepanz?

            DEINE AUFGABE:
            1.  Gehe die Checkliste durch und identifiziere ALLE zutreffenden Conversion-Killer.
            2.  Zähle die Gesamtzahl der gefundenen Killer.
            3.  Wähle die ZWEI gravierendsten Killer aus.
            4.  Formuliere für jeden der Top-Killer eine Detailbeschreibung.
            
            REGELN FÜR DIE ANTWORT:
            - Die Detailbeschreibung muss IMMER ein kurzes, wörtliches Zitat oder einen konkreten Wert von der Seite enthalten.
            - Die Detailbeschreibung darf MAXIMAL 15 Wörter lang sein.
            - Deine Antwort muss AUSSCHLIESSLICH ein JSON-Objekt sein, ohne Markdown-Formatierung oder einleitenden Text.

            HTML-AUSZUG ZUR ANALYSE:
            \`\`\`html
            ${pageContent}
            \`\`\`

            BEISPIEL-ANTWORT-FORMAT:
            {
              "totalFound": 5,
              "topKillers": [
                {
                  "title": "Unklare Value Proposition",
                  "detail": "Die Hauptüberschrift 'Herzlich Willkommen' kommuniziert keinen direkten Nutzen für den Besucher."
                },
                {
                  "title": "Schwacher Call-to-Action",
                  "detail": "Dem Button-Text 'Weiter' fehlt eine klare Handlungsaufforderung und ein spezifisches Versprechen."
                }
              ]
            }
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
        const responseText = responseData.candidates[0].content.parts[0].text;
        
        let analysisResult;
        try {
            const cleanedJsonString = responseText.match(/\{[\s\S]*\}/)[0];
            analysisResult = JSON.parse(cleanedJsonString);
        } catch (e) {
            console.error("Fehler beim Parsen der KI-Antwort:", responseText);
            throw new Error("Die Antwort der KI hatte ein unerwartetes Format.");
        }

        // --- GESCHÄFTSREGELN & ANTWORT-FORMATIERUNG ---
        const totalFound = analysisResult.totalFound || 0;

        // --- SONDERFALL 2: KEINE KILLER GEFUNDEN ---
        if (totalFound === 0) {
            const result = {
                isSpecialCase: true,
                specialNote: `Glückwunsch! Auf ${new URL(url).hostname} wurden keine gravierenden Conversion-Killer gefunden.`
            };
            await kv.set(cacheKey, result, { ex: 259200 }); // 3 Tage Cache
            return res.status(200).json(result);
        }
        
        const topKillers = analysisResult.topKillers || [];
        let topKillersToShow = [];
        let message = "";

        if (totalFound < 4) { // 1, 2 oder 3 Killer
            topKillersToShow = topKillers.slice(0, 1);
            message = `Gute Nachrichten! Auf ${new URL(url).hostname} wurde nur ${totalFound} potenzieller Conversion-Killer gefunden. Der wichtigste ist:`;
        } else { // 4 oder mehr Killer
            topKillersToShow = topKillers.slice(0, 2);
            message = `Analyse abgeschlossen. Auf ${new URL(url).hostname} wurden ${totalFound} potenzielle Conversion-Killer identifiziert. Die gravierendsten sind:`;
        }

        const finalResult = {
            message,
            topKillers: topKillersToShow,
            remainingKillers: Math.max(0, totalFound - topKillersToShow.length),
        };

        // --- CACHING & LOGGING ---
        await kv.set(cacheKey, finalResult, { ex: 259200 });
        await kv.set(`log:${new Date().toISOString()}:${url}`, {
            url,
            result: finalResult,
        });

        return res.status(200).json(finalResult);

    } catch (error) {
        console.error("Allgemeiner Fehler im API-Handler:", error);
        return res.status(500).json({ message: error.message || "Ein interner Serverfehler ist aufgetreten." });
    }
}
