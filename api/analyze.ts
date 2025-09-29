// /api/analyze.ts
// FINALE VERSION (5.0) - Korrekter Modellname und alle Fixes

import { NextApiRequest, NextApiResponse } from 'next';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { kv } from '@vercel/kv';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY!);

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

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Nur POST-Anfragen erlaubt.' });
    }

    let { url } = req.body;
    if (url && !url.startsWith('http')) {
        url = 'https://' + url;
    }

    const userIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress) as string;

    const rateLimitKey = `rate-limit:${userIp}`;
    const userRequests = (await kv.get<number>(rateLimitKey)) || 0;

    if (userRequests >= 2) {
        return res.status(429).json({ 
            limitReached: true, 
            message: 'Tageslimit von 2 Analysen erreicht.' 
        });
    }

    if (url.includes('luqy.studio')) {
        return res.status(200).json({ 
            isSpecialCase: true,
            specialNote: "Natürlich eine 10/10 Landing Page ;)" 
        });
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
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" }); // KORREKTER MODELLNAME
        
        const prompt = `
            Analysiere den folgenden Landing-Page-Text auf Basis bekannter Conversion-Killer.
            Identifiziere die ZWEI gravierendsten Probleme.
            Gib mir die Gesamtzahl aller gefundenen Probleme zurück.
            Für die zwei Hauptprobleme, gib mir zusätzlich eine kurze, personalisierte Detailbeschreibung. Diese Beschreibung soll, wenn möglich, ein konkretes Beispiel oder Zitat von der Webseite enthalten. Wenn ein Element fehlt (z.B. Social Proof), dann erwähne das explizit.
            Beispiel für einen schwachen CTA: "Der CTA-Button mit dem Text 'Mehr erfahren' ist zu vage und erzeugt keinen Handlungsimpuls."
            Beispiel für fehlende Garantien: "Es gibt keine sichtbaren Garantien oder risikomindernde Elemente wie 'Geld-zurück-Garantie', was das Vertrauen der Nutzer schwächen kann."
            Der Text stammt von der URL: ${url}
            Seiteninhalt: "${pageContent}"
            Gib die Antwort NUR im folgenden JSON-Format aus, ohne zusätzlichen Text davor oder danach:
            {
              "totalKillers": <Gesamtzahl der gefundenen Probleme als Zahl>,
              "topKillers": [
                {
                  "title": "<Überschrift des 1. Problems>",
                  "detail": "<Personalisierte Detailbeschreibung für Problem 1>"
                },
                {
                  "title": "<Überschrift des 2. Problems>",
                  "detail": "<Personalisierte Detailbeschreibung für Problem 2>"
                }
              ]
            }
        `;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        const analysisResult = JSON.parse(responseText);
        
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
        console.error("Fehler bei der personalisierten Gemini-Analyse:", error);
        return res.status(500).json({ message: "Analyse fehlgeschlagen. Bitte versuche es erneut." });
    }
}
