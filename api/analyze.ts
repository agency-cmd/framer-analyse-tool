// /api/analyze.ts
// VERSION 4.0 - mit personalisierter KI, angepasstem Limit & Caching

import { NextApiRequest, NextApiResponse } from 'next';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { kv } from '@vercel/kv';

// --- Konfiguration & Helper (bleiben gleich) ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY!);

async function fetchPageContent(url: string): Promise<string> {
    // ... (Diese Funktion bleibt unverändert)
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    // CORS Header (bleibt unverändert)
    res.setHeader('Access-Control-Allow-Origin', '*');
    // ... (restliche CORS-Header bleiben unverändert) ...

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

    // Eindeutiger Identifier für den Nutzer (IP-Adresse)
    const userIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress) as string;

    // --- NEUE REGEL 1: Fair-Use-Limit für alle Nutzer ---
    const rateLimitKey = `rate-limit:${userIp}`;
    const userRequests = (await kv.get<number>(rateLimitKey)) || 0;

    if (userRequests >= 2) {
        // Signal an das Frontend senden, dass das Limit erreicht ist
        return res.status(429).json({ 
            limitReached: true, 
            message: 'Tageslimit von 2 Analysen erreicht.' 
        });
    }

    // luqy.studio Sonderfall (bleibt unverändert)
    if (url.includes('luqy.studio')) {
        // ...
    }

    // --- NEUE REGEL 2: Caching für 3 Tage ---
    const cacheKey = `cache:${url}`;
    const cachedResult = await kv.get<any>(cacheKey);

    if (cachedResult) {
        // Wichtig: Auch eine zwischengespeicherte Anfrage zählt zum Tageslimit!
        await kv.incr(rateLimitKey);
        await kv.expire(rateLimitKey, 86400); // 24 Stunden in Sekunden
        return res.status(200).json(cachedResult);
    }
    
    try {
        const pageContent = await fetchPageContent(url);
        const model = genAI.getGenerativeModel({ model: "gemini-1.0-pro" });

        const prompt = `...`; // Der detaillierte, personalisierte Prompt bleibt hier unverändert

        const result = await model.generateContent(prompt);
        // ... (restliche Analyse-Logik bleibt unverändert) ...

        const finalResult = {
            // ... (Struktur des finalen Ergebnisses bleibt unverändert) ...
        };
        
        // Caching für 3 Tage (259200 Sekunden)
        await kv.set(cacheKey, finalResult, { ex: 259200 });

        // Tageslimit nach erfolgreicher Analyse erhöhen
        await kv.incr(rateLimitKey);
        await kv.expire(rateLimitKey, 86400);

        // Logging (bleibt unverändert)
        // ...
        
        return res.status(200).json(finalResult);

    } catch (error) {
        // ... (Fehlerbehandlung bleibt unverändert) ...
    }
}
