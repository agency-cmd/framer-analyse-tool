// /api/analyze.ts - v3.3 mit aktualisierter 11-Punkte-Checkliste
import { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';
import * as cheerio from 'cheerio';

// --- UMWELTSVARIABLEN ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BROWSERLESS_API_KEY = process.env.BROWSERLESS_API_KEY;

if (!GEMINI_API_KEY || !BROWSERLESS_API_KEY) {
    throw new Error("Erforderliche Umgebungsvariablen (GEMINI_API_KEY, BROWSERLESS_API_KEY) sind nicht gesetzt.");
}
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// --- DATENERFASSUNG (MIT KORREKTEM BROWSERLESS.IO PAYLOAD) ---
async function getCleanedPageContent(url: string): Promise<string> {
    try {
        const browserlessUrl = `https://production-sfo.browserless.io/content?token=${BROWSERLESS_API_KEY}`;

        const response = await fetch(browserlessUrl, {
            method: 'POST',
            headers: {
                'Cache-Control': 'no-cache',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url: url,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Browserless API Fehler! Status: ${response.status}. Details: ${errorText}`);
        }
        
        const html = await response.text();
        const $ = cheerio.load(html);

        $('script, style, noscript, svg, footer, nav').remove();
        const bodyHtml = $('body').html() || '';
        const condensedHtml = bodyHtml.replace(/\s+/g, ' ').trim();
        
        return condensedHtml.substring(0, 20000);

    } catch (error) {
        console.error(`Fehler beim Abrufen oder Parsen der URL ${url} via Browserless:`, error);
        throw new Error("Die Webseite konnte nicht vollständig geladen werden. Möglicherweise ist sie sehr langsam oder blockiert Analysen.");
    }
}

// --- API-HANDLER ---
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Methode nicht erlaubt. Nur POST-Anfragen sind zulässig.' });
    }

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

    if (url.includes('luqy.studio')) {
        return res.status(200).json({ isSpecialCase: true, specialNote: "Diese Landing Page ist offensichtlich perfekt. 😉 Bereit für deine eigene?" });
    }

    const cacheKey = `cro-analysis-v3.3:${url}`; // Version im Key erhöht
    try {
        const cachedResult = await kv.get<any>(cacheKey);
        if (cachedResult) {
            return res.status(200).json(cachedResult);
        }
    } catch (error) {
        console.error("Vercel KV Cache-Fehler (Lesen):", error);
    }

    try {
        const pageContent = await getCleanedPageContent(url);
        
        // --- START DER ÄNDERUNG: AKTUALISIERTER PROMPT ---
        const prompt = `
            Du bist ein Weltklasse Conversion-Optimierer und Berater.
            Deine Aufgabe ist es, einen HTML-Auszug zu analysieren und die Ergebnisse für einen Laien (z.B. einen Geschäftsführer) verständlich aufzubereiten.
            Vermeide Fachjargon und erkläre die Probleme so, dass der Geschäftsnutzen klar wird.

            ANALYSE-CHECKLISTE (NEUE VERSION, NACH WICHTIGKEIT GEORDNET):
            1.  **Langsame Ladezeit:** Suche nach Indikatoren für eine langsame Seite (viele Skripte, unoptimierte Bilder).
            2.  **Fehlende mobile Optimierung:** Prüfe auf fehlende Viewport-Tags oder starre Layouts.
            3.  **Unklare Value Proposition:** Ist die H1-Überschrift spezifisch und nutzerorientiert oder vage wie "Willkommen"?
            4.  **"Message Match"-Fehler:** Vergleiche den Seitentitel (<title>) mit der Hauptüberschrift (<h1>). Gibt es eine klare Diskrepanz?
            5.  **Schwacher Call-to-Action (CTA):** Sind Button-Texte passiv (z.B. "Mehr erfahren") statt aktiv (z.B. "Jetzt starten")?
            6.  **Offensichtliche technische Fehler:** Suche nach Hinweisen auf kaputte Bilder oder fehlerhafte Links.
            7.  **Fehlende Vertrauenssignale:** Fehlen Keywords wie "Kundenstimmen", "Garantie", "Sicher", "Zertifikat" oder Links zu Datenschutz/Impressum?
            8.  **Zu viele Ablenkungen:** Gibt es zu viele Links (Social Media, Blog, "Über uns"), die vom Hauptziel ablenken?
            9.  **Komplexes Formular:** Analysiere <form>-Elemente. Werden mehr als 4-5 Informationen für einen einfachen Lead abgefragt?
            10. **Schlechte Lesbarkeit:** Gibt es lange Textblöcke ohne Absätze, zu kleine Schrift oder schlechte Kontraste?
            11. **Aufdringliche Pop-ups:** Gibt es Hinweise auf Overlays, die den Inhalt sofort bei Seitenaufruf verdecken?

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
        // --- ENDE DER ÄNDERUNG ---

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
        
        if (!responseData.candidates || !responseData.candidates[0].content.parts[0].text) {
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
            const result = {
                isSpecialCase: true,
                specialNote: `Glückwunsch! Auf ${new URL(url).hostname} wurden keine gravierenden Conversion-Killer gefunden.`
            };
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

        const finalResult = {
            message,
            topKillers: topKillersToShow,
            remainingKillers: Math.max(0, totalFound - topKillersToShow.length),
        };

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
