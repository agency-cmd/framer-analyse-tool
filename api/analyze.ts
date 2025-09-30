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
        
// ... (der Anfang der Datei bleibt unverändert)

try {
    // --- HAUPTLOGIK: ANALYSE ---
    const pageContent = await getCleanedPageContent(url);
    
    // START: ERSETZE DEN ALTEN PROMPT DURCH DIESEN NEUEN BLOCK
    const prompt = `
        Du bist ein Weltklasse Conversion-Optimierer und Berater.
        Deine Aufgabe ist es, einen HTML-Auszug zu analysieren und die Ergebnisse für einen Laien (z.B. einen Geschäftsführer) verständlich aufzubereiten.
        Vermeide Fachjargon und erkläre die Probleme so, dass der Geschäftsnutzen klar wird.

        ANALYSE-CHECKLISTE:
        1.  **Lange Ladezeit:** Gibt es Hinweise auf eine langsame Seite?
        2.  **Unklar für Mobilgeräte:** Könnte die Seite auf dem Handy schlecht aussehen?
        3.  **Unklare Botschaft:** Versteht ein Besucher in 3 Sekunden, was er hier bekommt?
        4.  **Schwache Handlungsaufforderung:** Sind die Buttons klar und motivierend beschriftet?
        5.  **Störende Pop-ups:** Gibt es Hinweise auf Elemente, die den Inhalt sofort verdecken?
        6.  **Fehlendes Vertrauen:** Fehlen Kundenstimmen, Siegel oder klare Kontaktinfos?
        7.  **Komplizierte Formulare:** Muss man zu viele Felder ausfüllen?
        8.  **Schlechte Lesbarkeit:** Ist der Text anstrengend zu lesen (z.B. zu klein, zu lang)?
        9.  **Technische Fehler:** Gibt es Hinweise auf kaputte Bilder oder Links?
        10. **Verwirrende Botschaft:** Passen Werbeanzeige und Seiteninhalt zusammen?

        DEINE AUFGABE:
        1.  Identifiziere ALLE zutreffenden Probleme aus der Checkliste.
        2.  Zähle die Gesamtzahl der gefundenen Probleme.
        3.  Wähle die ZWEI gravierendsten aus.
        4.  Formuliere für die Top-Probleme einen Titel und eine Detailbeschreibung.

        REGELN FÜR DIE ANTWORT:
        - Die Titel müssen das Problem aus Nutzersicht beschreiben (z.B. "Besucher fühlen sich unsicher").
        - Die Detailbeschreibung muss das Problem erklären, ein Zitat von der Seite enthalten UND den negativen Effekt auf Nutzer hervorheben.
        - Die Detailbeschreibung darf MAXIMAL 25 Wörter lang sein.
        - Deine Antwort muss AUSSCHLIESSLICH ein JSON-Objekt sein, ohne Markdown.

        HTML-AUSZUG ZUR ANALYSE:
        \`\`\`html
        ${pageContent}
        \`\`\`

        GUTE, VERSTÄNDLICHE BEISPIELE (NEUER STIL):
        {
          "totalFound": 4,
          "topKillers": [
            {
              "title": "Besucher verstehen den Nutzen nicht",
              "detail": "Die Überschrift 'Herzlich Willkommen' erklärt nicht den Vorteil. Nutzer springen ab, wenn sie nicht sofort wissen, was die Seite für sie tut."
            },
            {
              "title": "Unklare Handlungsaufforderung",
              "detail": "Der Button 'Mehr erfahren' ist zu passiv. Besucher klicken eher auf eine klare Anweisung wie 'Jetzt Analyse starten' und konvertieren dadurch häufiger."
            }
          ]
        }
    `;
    // ENDE: ERSETZE DEN ALTEN PROMPT DURCH DIESEN NEUEN BLOCK

    const apiResponse = await fetch(GEMINI_API_URL, {
        // ... (der Rest der Datei bleibt unverändert)

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
