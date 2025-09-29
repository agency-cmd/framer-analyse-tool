// /api/analyze.ts
// FINALE VERSION (Hybrid-Engine v1.0) - Heuristik + PageSpeed API

import type { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';

const PAGESPEED_API_KEY = process.env.PAGESPEED_API_KEY;

type Killer = {
    title: string;
    detail: string;
};

// --- HEURISTIK-CHECKS (Der Inhalts-Experte) ---
const runHeuristicChecks = (content: string, url: string): Killer[] => {
    const found: Killer[] = [];
    const cleanText = (text: string) => text.trim().replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');

    // Nutzenversprechen (H1)
    const h1Match = content.match(/<h1[^>]*>(.*?)<\/h1>/i);
    if (!h1Match || !h1Match[1]) {
        found.push({ title: "Fehlendes Nutzenversprechen", detail: "Auf der Seite fehlt eine klare H1-Überschrift, um den Hauptnutzen auf den ersten Blick zu verdeutlichen." });
    } else {
        const text = cleanText(h1Match[1]);
        if (text.length < 15 || text.toLowerCase().includes("willkommen")) {
            found.push({ title: "Schwaches Nutzenversprechen", detail: `Die Hauptüberschrift "${text}" ist möglicherweise zu kurz oder zu generisch, um den Kundennutzen klar zu kommunizieren.` });
        }
    }

    // Call to Action (Button)
    const buttonMatch = content.match(/<button[^>]*>(.*?)<\/button>/i);
    if (!buttonMatch || !buttonMatch[1]) {
        found.push({ title: "Fehlende Handlungsaufforderung", detail: "Es wurde kein primärer <button>-Tag gefunden. Ein klarer Call-to-Action ist entscheidend für die Conversion." });
    } else {
        const text = cleanText(buttonMatch[1]);
        if (["mehr erfahren", "klicken sie hier", "weiter", "absenden"].includes(text.toLowerCase())) {
            found.push({ title: "Schwache Handlungsaufforderung", detail: `Der Call-to-Action "${text}" ist sehr generisch. Nutzenorientierte Texte wie "Analyse starten" sind oft effektiver.` });
        }
    }

    // Fehlendes Impressum
    if (!/impressum/i.test(content)) {
         found.push({ title: "Fehlendes Impressum", detail: "Im Quellcode wurde kein Link oder Hinweis auf ein Impressum gefunden, was in der DACH-Region rechtlich erforderlich ist." });
    }

    // Fehlende SSL-Verbindung
    if (!url.startsWith('https://')) {
        found.push({ title: "Unsichere Verbindung (Kein SSL)", detail: "Die Webseite wird nicht über eine sichere HTTPS-Verbindung ausgeliefert. Browser warnen Besucher oft vor solchen unsicheren Seiten." });
    }

    return found;
};

// --- PAGESPEED-CHECKS (Der technische Prüfer) ---
const runPageSpeedChecks = async (url: string): Promise<Killer[]> => {
    const found: Killer[] = [];
    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&key=${PAGESPEED_API_KEY}&strategy=mobile&category=performance&category=accessibility`;

    try {
        const response = await fetch(apiUrl);
        if (!response.ok) return found;
        const data = await response.json();
        const lighthouse = data.lighthouseResult;

        // Performance
        const perfScore = lighthouse.categories.performance.score * 100;
        if (perfScore < 50) {
            found.push({ title: "Langsame Ladezeiten", detail: `Die mobile Performance ist mit einem Score von ${perfScore}/100 kritisch. Langsame Seiten führen zu hohen Absprungraten.` });
        } else if (perfScore < 90) {
            found.push({ title: "Mäßige Ladezeiten", detail: `Die mobile Performance ist mit ${perfScore}/100 verbesserungswürdig. Schnellere Ladezeiten verbessern die Nutzererfahrung deutlich.` });
        }

        // Responsivität / Viewport
        if (lighthouse.audits['viewport'].score !== 1) {
             found.push({ title: "Mangelnde Mobiloptimierung", detail: "Der wichtige 'viewport'-Meta-Tag fehlt oder ist fehlerhaft. Dies führt zu einer schlechten Darstellung auf Smartphones." });
        }

        return found;
    } catch (e) {
        return found;
    }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { return res.status(200).end(); }
    if (req.method !== 'POST') { return res.status(405).json({ message: 'Nur POST-Anfragen erlaubt.' }); }

    let { url } = req.body;
    if (url && !url.startsWith('http')) { url = 'https://' + url; }

    if (url.includes('luqy.studio')) {
        return res.status(200).json({ isSpecialCase: true, specialNote: "Natürlich eine 10/10 Landing Page ;)" });
    }

    try {
        const rawContentPromise = fetch(url).then(r => {
            if (!r.ok) throw new Error("Seite nicht erreichbar.");
            return r.text();
        });
        const pageSpeedPromise = runPageSpeedChecks(url);

        const [rawContent, pageSpeedKillers] = await Promise.all([rawContentPromise, pageSpeedPromise]);
        const heuristicKillers = runHeuristicChecks(rawContent, url);
        const allKillers = [...pageSpeedKillers, ...heuristicKillers];

        if (allKillers.length < 2) {
             return res.status(200).json({
                message: `Sehr gut! Auf ${new URL(url).hostname} wurden kaum Schwachstellen gefunden.`,
                topKillers: [{ title: "Solide technische Basis", detail: "Die Seite scheint technisch gut aufgestellt zu sein." }, { title: "Gute Inhaltsstruktur", detail: "Die grundlegende Struktur der Inhalte ist klar." }],
                remainingKillers: 0,
            });
        }

        const finalResult = {
            message: `Auf der Landing Page von ${new URL(url).hostname} gibt es aktuell ${allKillers.length} potenzielle Conversion-Killer. Darunter:`,
            topKillers: allKillers.slice(0, 2),
            remainingKillers: Math.max(0, allKillers.length - 2),
        };

        return res.status(200).json(finalResult);

    } catch (error) {
        return res.status(500).json({ message: 'Die Seite konnte nicht analysiert werden. Ist die URL korrekt und öffentlich erreichbar?' });
    }
}
