// /api/analyze.ts
// FINALE VERSION (v2.1) mit heuristischer Analyse und CORS-Fix

import type { NextApiRequest, NextApiResponse } from 'next';

// --- HELPER-FUNKTIONEN ---
const countOccurrences = (text: string, pattern: RegExp) => (text.match(pattern) || []).length;

// --- DIE CHECKLISTE mit heuristischen Checks ---
const conversionKillers = [
    // Technisch messbar
    { id: "SSL", title: "Fehlendes Vertrauen (Kein SSL/HTTPS)", check: (content, url) => !url.startsWith('https://') },
    { id: "AUTO_MEDIA", title: "Automatisch startende Medieninhalte", check: (content) => /<video[^>]+autoplay/i.test(content) || /<audio[^>]+autoplay/i.test(content) },

    // Heuristiken für Inhalt & Struktur
    { id: "VALUE_PROP", title: "Unklares Nutzenversprechen", check: (content) => !/<h1/i.test(content) },
    { id: "CTA", title: "Schwache oder unklare Handlungsaufforderungen", check: (content) => countOccurrences(content, /<button/gi) === 0 },
    { id: "LANGE_FORMULARE", title: "Lange und komplexe Formulare", check: (content) => countOccurrences(content, /<input/gi) > 6 },
    { id: "KONTAKT", title: "Schwer auffindbare Kontakt- oder Support-Möglichkeiten", check: (content) => !/kontakt|impressum|support|hilfe/i.test(content) },
    { id: "SOCIAL_PROOF", title: "Fehlender sozialer Beweis (Social Proof)", check: (content) => !/kundenstimmen|bewertungen|referenzen|erfahrungen/i.test(content) },
    { id: "HANDLUNGSIMPULS", title: "Fehlender Handlungsimpuls (Dringlichkeit)", check: (content) => !/jetzt|sofort|heute|angebot|nur für kurze zeit/i.test(content) },
    { id: "GARANTIEN", title: "Fehlende Garantien oder unklare Risikoumkehr", check: (content) => !/garantie|risikofrei|geld-zurück|kostenlos testen/i.test(content) },

    // Heuristiken für Design & UX
    { id: "VISUELLES_DURCHEINANDER", title: "Visuelles Durcheinander und Design", check: (content) => countOccurrences(content, /font-family:/gi) > 5 || countOccurrences(content, /color:/gi) > 20 },
    { id: "ABLENKUNGEN", title: "Zu viele Ablenkungen", check: (content) => countOccurrences(content, /<a href/gi) > 100 },
    { id: "UNTERBRECHUNGEN", title: "Aufdringliche und störende Unterbrechungen", check: (content) => /popup|modal|overlay|cookie-banner/i.test(content) }, // Vereinfacht
    { id: "NAVIGATION", title: "Komplizierte oder unübersichtliche Navigation", check: (content) => countOccurrences(content, /<nav[^>]*>.*?<a/gi) > 20 },
    
    // Komplexere Analysen (vereinfachte Platzhalter)
    { id: "LADEZEIT", title: "Langsame Ladezeiten", check: (content) => content.length > 2000000 }, // Annahme: Sehr große HTML-Datei = langsam
    { id: "MOBILE_UX", title: "Schlechte mobile Nutzererfahrung", check: (content) => !/<meta[^>]+name=["']viewport["']/i.test(content) }, // Wichtiger Meta-Tag für Responsive Design fehlt
    { id: "LESBARKEIT", title: "Schlechte Lesbarkeit", check: (content) => countOccurrences(content, /font-size:\s*(10|11|12|13)px/gi) > 3 }, // Annahme: Häufige Verwendung kleiner Schriftgrößen
    { id: "ANGEBOTSBESCHREIBUNG", title: "Unzureichende Angebotsbeschreibung", check: (content) => countOccurrences(content, /<p>/gi) < 5 }, // Annahme: Sehr wenige Paragraphen
    { id: "VISUELLE_PRAESENTATION", title: "Schlechte visuelle Präsentation des Angebots", check: (content) => countOccurrences(content, /<img/gi) === 0 }, // Annahme: Keine Bilder zur Präsentation
    { id: "SICHTBARKEIT", title: "Wichtige Inhalte nicht sofort sichtbar", check: (content) => content.indexOf('<h1') > 3000 }, // Annahme: H1-Tag erscheint sehr spät im Code

    // Schwer/nicht messbare Punkte (basierend auf Indizien)
    { id: "NACHTEILE", title: "Unerwartete Nachteile oder Kosten", check: (content) => /versandkosten|gebühren|zzgl\./i.test(content) && !/kostenloser versand/i.test(content) },
    { id: "ANMELDUNG", title: "Erzwungener Anmelde- oder Registrierungsprozess", check: (content) => /registrieren|konto erstellen/i.test(content) && !/gast|ohne anmeldung/i.test(content) },
    { id: "INTERNE_SUCHE", title: "Eine schlecht funktionierende interne Suche", check: (content) => /type=["']search["']/i.test(content) && countOccurrences(content, /<script/gi) < 5 }, // Annahme: Suchfeld ohne viel JavaScript-Logik
    { id: "ABSCHLUSSOPTIONEN", title: "Mangel an relevanten Abschlussoptionen", check: (content) => countOccurrences(content, /paypal|kreditkarte|klarna|rechnung/gi) < 2 },
    { id: "INKONSISTENTES_MESSAGING", title: "Inkonsistentes Messaging", check: (content) => !/<title>.*<\/title>/.test(content) || !/<meta[^>]+name=["']description["']/.test(content) }, // Annahme: Fehlende Basis-Metatags als Zeichen für mangelnde Sorgfalt
    { id: "FEHLERSEITEN", title: "Fehlerseiten und defekte Links", check: (content) => /404|nicht gefunden|seite nicht gefunden/i.test(content) }, // Checkt, ob die aufgerufene Seite selbst eine Fehlerseite ist
];

const cache = new Map<string, any>();
const rateLimiter = new Map<string, number>();

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    // --- CORS-HEADER FIX ---
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    // --- ENDE FIX ---

    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Nur POST-Anfragen erlaubt.' });
    }

    let { url } = req.body;
    if (url && !url.startsWith('http')) {
        url = 'https://' + url;
    }
    const userIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress) as string;

    if (!url || !url.includes('.')) {
        return res.status(400).json({ message: 'Bitte gib eine gültige URL ein.' });
    }

    if (url.includes('luqy.studio')) {
        return res.status(200).json({
            message: `Die Analyse von ${new URL(url).hostname} ist abgeschlossen.`,
            topKillers: ["Perfektion", "Genialität"],
            remainingKillers: 0,
            isSpecialCase: true,
            specialNote: "Natürlich eine 10/10 Landing Page ;)"
        });
    }

    const userRequests = rateLimiter.get(userIp) || 0;
    if (userRequests >= 2) {
        return res.status(429).json({ message: 'Analyse-Limit für heute erreicht.' });
    }

    if (cache.has(url) && (Date.now() - cache.get(url).timestamp < 7 * 24 * 60 * 60 * 1000)) {
        rateLimiter.set(userIp, userRequests + 1);
        return res.status(200).json(cache.get(url).data);
    }
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`Seite nicht erreichbar (Status: ${response.status}).`);
        }
        const content = await response.text();

        const foundKillers = conversionKillers
            .filter(killer => killer.check(content, url))
            .map(killer => killer.title);
        
        if (foundKillers.length < 2) {
             const resultData = {
                message: `Sehr gut! Auf ${new URL(url).hostname} wurden kaum Schwachstellen gefunden.`,
                topKillers: ["Saubere Struktur", "Klares Design"],
                remainingKillers: 0,
            };
            cache.set(url, { timestamp: Date.now(), data: resultData });
            rateLimiter.set(userIp, userRequests + 1);
            return res.status(200).json(resultData);
        }
        
        const topKillers = foundKillers.slice(0, 2);
        const resultData = {
            message: `Auf der Landing Page von ${new URL(url).hostname} gibt es aktuell ${foundKillers.length} Conversion-Killer. Darunter:`,
            topKillers: topKillers,
            remainingKillers: Math.max(0, foundKillers.length - 2),
        };

        cache.set(url, { timestamp: Date.now(), data: resultData });
        rateLimiter.set(userIp, userRequests + 1);

        return res.status(200).json(resultData);

    } catch (error) {
        if (error.name === 'AbortError') {
            return res.status(500).json({ message: 'Die Seite hat zu lange zum Laden gebraucht.' });
        }
        return res.status(500).json({ message: 'Die Seite konnte nicht analysiert werden. Ist die URL korrekt und erreichbar?' });
    }
}
