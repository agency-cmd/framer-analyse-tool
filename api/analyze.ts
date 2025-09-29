// /api/analyze.ts
// FINALE VERSION (Gemini-Engine v7.0) - Mit dynamischen Ergebnissen & Datenschutz

import { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

async function fetchPageContent(url: string): Promise<string> {
    try {
        const response = await fetch(url);
        const html = await response.text();
        return html.replace(/<style[^>]*>.*<\/style>/gms, "")
                   .replace(/<script[^>]*>.*<\/script>/gms, "")
                   .replace(/<[^>]+>/g, ' ')
                   .replace(/\s+/g, ' ')
                   .trim()
                   .substring(0, 15000);
    } catch (error) {
        console.error("Fehler beim Fetchen der Seite:", error);
        throw new Error("Die Webseite konnte nicht geladen werden.");
    }
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { return res.status(200).end(); }
    if (req.method !== 'POST') { return res.status(405).json({ message: 'Nur POST-Anfragen erlaubt.' }); }

    let { url } = req.body;
    if (url && !url.startsWith('http')) { url = 'https://' + url; }

    if (!url || !url.includes('.')) {
        return res.status(400).json({ message: 'Bitte gib eine gültige URL ein.' });
    }

    if (url.includes('luqy.studio')) {
        return res.status(200).json({ isSpecialCase: true, specialNote: "Natürlich eine 10/10 Landing Page ;)" });
    }

    // Angepasstes Caching für 3 Tage
    const cacheKey = `cache:${url}`;
    const cachedResult = await kv.get<any>(cacheKey);
    if (cachedResult) {
        return res.status(200).json(cachedResult);
    }
    
    try {
        const pageContent = await fetchPageContent(url);
        
        const prompt = `Analysiere den folgenden Landing-Page-Text auf Basis bekannter Conversion-Killer. Identifiziere die ZWEI gravierendsten Probleme. Gib mir die Gesamtzahl aller gefundenen Probleme zurück. Für die zwei Hauptprobleme, gib mir zusätzlich eine kurze, personalisierte Detailbeschreibung. Diese Beschreibung soll, wenn möglich, ein konkretes Beispiel oder Zitat von der Webseite enthalten. Wenn ein Element fehlt (z.B. Social Proof), dann erwähne das explizit. Beispiel für einen schwachen CTA: "Der CTA-Button mit dem Text 'Mehr erfahren' ist zu vage und erzeugt keinen Handlungsimpuls." Beispiel für fehlende Garantien: "Es gibt keine sichtbaren Garantien oder risikomindernde Elemente wie 'Geld-zurück-Garantie', was das Vertrauen der Nutzer schwächen kann." Der Text stammt von der URL: ${url} Seiteninhalt: "${pageContent}" Gib die Antwort NUR im folgenden JSON-Format aus, ohne zusätzlichen Text davor oder danach: { "totalKillers": <Gesamtzahl der gefundenen Probleme als Zahl>, "topKillers": [ { "title": "<Überschrift des 1. Problems>", "detail": "<Personalisierte Detailbeschreibung für Problem 1>" }, { "title": "<Überschrift des 2. Problems>", "detail": "<Personalisierte Detailbeschreibung für Problem 2>" } ] }`;

        const requestBody = {
            contents: [{ parts: [{ text: prompt }] }],
        };

        const apiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });

        if (!apiResponse.ok) {
            const errorBody = await apiResponse.json();
            console.error("Fehler von Google API:", errorBody);
            throw new Error(`Google API Fehler: ${errorBody.error.message}`);
        }

        const responseData = await apiResponse.json();
        const responseText = responseData.candidates[0].content.parts[0].text;
        
        const jsonMatch = responseText.match(/{[\s\S]*}/);
        if (!jsonMatch) {
            throw new Error("Ungültiges JSON-Format von der API erhalten.");
        }
        const cleanedJsonString = jsonMatch[0];
        const analysisResult = JSON.parse(cleanedJsonString);
        
        // *** HIER IST DEINE NEUE, DYNAMISCHE LOGIK ***
        const totalKillers = analysisResult.totalKillers;
        
        if (totalKillers < 2) {
             const positiveResult = {
                message: `Sehr gut! Auf ${new URL(url).hostname} wurden kaum Schwachstellen gefunden.`,
                topKillers: [{ title: "Solide technische Basis", detail: "Die Seite scheint technisch gut aufgestellt zu sein." }, { title: "Gute Inhaltsstruktur", detail: "Die grundlegende Struktur der Inhalte ist klar." }],
                remainingKillers: 0,
            };
            await kv.set(cacheKey, positiveResult, { ex: 259200 }); // 3 Tage Caching
            return res.status(200).json(positiveResult);
        }

        let topKillersToShow;
        let messageText;

        if (totalKillers < 5) { // 2, 3 oder 4 Killer
            topKillersToShow = analysisResult.topKillers.slice(0, 1);
            messageText = `Auf der Landing Page von ${new URL(url).hostname} gibt es aktuell ${totalKillers} potenzielle Conversion-Killer. Der wichtigste ist:`;
        } else { // 5 oder mehr Killer
            topKillersToShow = analysisResult.topKillers.slice(0, 2);
            messageText = `Auf der Landing Page von ${new URL(url).hostname} gibt es aktuell ${totalKillers} potenzielle Conversion-Killer. Darunter:`;
        }

        const finalResult = {
            message: messageText,
            topKillers: topKillersToShow,
            remainingKillers: Math.max(0, totalKillers - topKillersToShow.length),
        };

        // Speichern im Cache für 3 Tage
        await kv.set(cacheKey, finalResult, { ex: 259200 });
        
        // Logging ohne IP-Adresse
        const logEntry = {
            timestamp: new Date().toISOString(),
            requestedUrl: url,
            foundKillersCount: totalKillers,
            topKillers: finalResult.topKillers,
        };
        await kv.set(`log:${Date.now()}:${url}`, JSON.stringify(logEntry));
        
        return res.status(200).json(finalResult);

    } catch (error) {
        console.error("Fehler im Handler:", error);
        return res.status(500).json({ message: "Analyse fehlgeschlagen. Bitte versuche es erneut." });
    }
}
