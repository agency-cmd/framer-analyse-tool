// /api/analyze.ts
// FINALE VERSION (6.0) - Direkter Fetch-Aufruf an die Google API

import { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`;

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

    const userIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress) as string;

    const rateLimitKey = `rate-limit:${userIp}`;
    const userRequests = (await kv.get<number>(rateLimitKey)) || 0;
    if (userRequests >= 2) {
        return res.status(429).json({ limitReached: true, message: 'Tageslimit von 2 Analysen erreicht.' });
    }

    if (url.includes('luqy.studio')) {
        return res.status(200).json({ isSpecialCase: true, specialNote: "Natürlich eine 10/10 Landing Page ;)" });
    }

    const cacheKey = `cache:${url}`;
    const cachedResult = await kv.get<any>(cacheKey);
    if (cachedResult) {
        await kv.incr(rateLimitKey);
        await kv.expire(rateLimitKey, 86400);
        return res.status(200).json(cachedResult);
    }
    
    try {
        const pageContent = await fetchPageContent(url);
        
        //const prompt = `Analysiere den folgenden Landing-Page-Text auf Basis bekannter Conversion-Killer. Identifiziere die ZWEI gravierendsten Probleme. Gib mir die Gesamtzahl aller gefundenen Probleme zurück. Für die zwei Hauptprobleme, gib mir zusätzlich eine kurze, personalisierte Detailbeschreibung. Diese Beschreibung soll, wenn möglich, ein konkretes Beispiel oder Zitat von der Webseite enthalten. Wenn ein Element fehlt (z.B. Social Proof), dann erwähne das explizit. Beispiel für einen schwachen CTA: "Der CTA-Button mit dem Text 'Mehr erfahren' ist zu vage und erzeugt keinen Handlungsimpuls." Beispiel für fehlende Garantien: "Es gibt keine sichtbaren Garantien oder risikomindernde Elemente wie 'Geld-zurück-Garantie', was das Vertrauen der Nutzer schwächen kann." Der Text stammt von der URL: ${url} Seiteninhalt: "${pageContent}" Gib die Antwort NUR im folgenden JSON-Format aus, ohne zusätzlichen Text davor oder danach: { "totalKillers": <Gesamtzahl der gefundenen Probleme als Zahl>, "topKillers": [ { "title": "<Überschrift des 1. Problems>", "detail": "<Personalisierte Detailbeschreibung für Problem 1>" }, { "title": "<Überschrift des 2. Problems>", "detail": "<Personalisierte Detailbeschreibung für Problem 2>" } ] }`;
        const prompt = `Von 1-10, wie professionell ist die Seite https://magile.at. Gib mir die Zahl im folgenden JSON Format zurück: {result: 3}. Gib die Antwort NUR im folgenden JSON-Format aus, ohne zusätzlichen Text davor oder danach.`;
console.info("Promot:", prompt); 
        const requestBody = {
            contents: [{ parts: [{ text: prompt }] }],
        };
console.info("requestBody:", requestBody); 
        const apiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });
console.info("Warte auf Response:"); 
        if (!apiResponse.ok) {
            const errorBody = await apiResponse.json();
            console.error("Fehler von Google API:", errorBody);
            throw new Error(`Google API Fehler: ${errorBody.error.message}`);
        }

        const responseData = await apiResponse.json();
        const responseText = responseData.candidates[0].content.parts[0].text;
console.info("Response:", responseText); 
console.log("--- DEBUG START ---");
console.log("Typ der Variable:", typeof responseText);
console.log("Inhalt der Variable:", responseText);
console.log("--- DEBUG END ---");
        
        const analysisResult = JSON.parse(responseText);
 console.info("analysisResult:", analysisResult);        
        const finalResult = {
            message: `Auf der Landing Page von ${new URL(url).hostname} gibt es aktuell ${analysisResult.totalKillers} Conversion-Killer. Darunter:`,
            topKillers: analysisResult.topKillers,
            remainingKillers: Math.max(0, analysisResult.totalKillers - 2),
        };
        
        await kv.set(cacheKey, finalResult, { ex: 259200 });
        await kv.incr(rateLimitKey);
        await kv.expire(rateLimitKey, 86400);

        const logEntry = { timestamp: new Date().toISOString(), requestedUrl: url, result: finalResult };
        await kv.set(`log:${Date.now()}:${url}`, JSON.stringify(logEntry));
        
        return res.status(200).json(finalResult);

    } catch (error) {
        console.error("Fehler im Handler:", error);
        return res.status(500).json({ message: "Analyse fehlgeschlagen. Bitte versuche es erneut." });
    }
}
