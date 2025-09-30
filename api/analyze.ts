// /api/analyze.ts - v3.5 mit intelligenter Vorverarbeitung für mehr Geschwindigkeit
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

// --- DATENERFASSUNG (unverändert) ---
async function getFullPageHtml(url: string): Promise<string> {
    try {
        const browserlessUrl = `https://production-sfo.browserless.io/content?token=${BROWSERLESS_API_KEY}`;
        const response = await fetch(browserlessUrl, {
            method: 'POST',
            headers: {
                'Cache-Control': 'no-cache',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url: url }),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Browserless API Fehler! Status: ${response.status}. Details: ${errorText}`);
        }
        return await response.text();
    } catch (error) {
        console.error(`Fehler beim Abrufen der URL ${url} via Browserless:`, error);
        throw new Error("Die Webseite konnte nicht vollständig geladen werden. Möglicherweise ist sie sehr langsam oder blockiert Analysen.");
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

    const cacheKey = `cro-analysis-v3.5:${url}`;
    try {
        const cachedResult = await kv.get<any>(cacheKey);
        if (cachedResult) { return res.status(200).json(cachedResult); }
    } catch (error) { console.error("Vercel KV Cache-Fehler (Lesen):", error); }

    try {
        const fullHtml = await getFullPageHtml(url);
        const $ = cheerio.load(fullHtml);

        // --- START: INTELLIGENTE VORVERARBEITUNG ---
        // Statt rohem HTML erstellen wir eine strukturierte Zusammenfassung.
        const pageSummary = `
          SEITENTITEL: "${$('title').text().trim()}"
          
          META-VIEWPORT: "${$('meta[name="viewport"]').attr('content') || 'Nicht vorhanden'}"

          HAUPTÜBERSCHRIFT (H1): "${$('h1').first().text().trim()}"
          
          WEITERE ÜBERSCHRIFTEN (H2):
          ${$('h2').map((_, el) => `- "${$(el).text().trim()}"`).get().join('\n')}

          BUTTONS & CALL-TO-ACTIONS:
          ${$('button, a[role="button"], .button, .btn').map((_, el) => `- TEXT: "${$(el).text().trim()}" TAG: <${el.tagName}>`).get().slice(0, 10).join('\n')}
          
          FORMULARFELDER (${$('form input, form textarea, form select').length} gefunden):
          ${$('form').map((_, form) => {
              const inputs = $(form).find('input, textarea, select');
              return `FORMULAR: ${inputs.length} Felder. Labels: ${inputs.map((_, input) => `"${$('label[for="' + $(input).attr('id') + '"]').text().trim()}"`).get().join(', ')}`;
          }).get().join('\n')}
          
          LINKS/NAVIGATION (${$('a').length} gefunden, erste 15):
          ${$('a').map((_, el) => `- TEXT: "${$(el).text().trim()}"`).get().slice(0, 15).join('\n')}

          AUSGEWÄHLTE TEXTABSCHNITTE:
          ${$('p').map((_, el) => $(el).text().trim()).get().filter(text => text.length > 50).slice(0, 5).join('\n\n')}
        `.replace(/\s+/g, ' ').trim();
        // --- ENDE: INTELLIGENTE VORVERARBEITUNG ---

        const prompt = `
            Du bist ein Weltklasse Conversion-Optimierer. Analysiere die folgende strukturierte Zusammenfassung einer Webseite.
            
            ANALYSE-CHECKLISTE:
            1.  **Langsame Ladezeit:** Nicht direkt messbar, aber deuten viele Links/Elemente auf eine schwere Seite hin?
            2.  **Fehlende mobile Optimierung:** Ist der META-VIEWPORT-Tag vorhanden und korrekt konfiguriert?
            3.  **Unklare Value Proposition:** Ist die HAUPTÜBERSCHRIFT (H1) spezifisch und nutzerorientiert?
            4.  **"Message Match"-Fehler:** Gibt es eine Diskrepanz zwischen SEITENTITEL und HAUPTÜBERSCHRIFT?
            5.  **Schwacher Call-to-Action (CTA):** Sind die BUTTONS & CALL-TO-ACTIONS aktiv und klar formuliert?
            6.  **Offensichtliche technische Fehler:** Gibt es Links oder Buttons ohne Text?
            7.  **Fehlende Vertrauenssignale:** Enthalten die TEXTABSCHNITTE Keywords wie "Kunden", "Garantie", "sicher"?
            8.  **Zu viele Ablenkungen:** Gibt es eine hohe Anzahl an LINKS/NAVIGATION im Verhältnis zu den CTAs?
            9.  **Komplexes Formular:** Haben die FORMULARFELDER mehr als 4-5 Einträge für einen einfachen Zweck?
            10. **Schlechte Lesbarkeit:** Sind die TEXTABSCHNITTE sehr lang und unformatiert?
            11. **Aufdringliche Pop-ups:** Nicht direkt erkennbar, aber deuten Button-Texte wie "Schließen" darauf hin?

            DEINE AUFGABE & REGELN sind unverändert:
            - Identifiziere ALLE Probleme, zähle sie und wähle die TOP 2.
            - Titel aus Nutzersicht.
            - Detailbeschreibung (max. 25 Wörter) muss das Problem erklären, ein Zitat/Wert aus der Zusammenfassung enthalten und den negativen Effekt aufzeigen.
            - Antwort nur als JSON.

            STRUKTURIERTE ZUSAMMENFASSUNG ZUR ANALYSE:
            \`\`\`
            ${pageSummary}
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
