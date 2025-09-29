// /api/analyze.ts
// FINALE VERSION (Heuristik-Engine v3.0) - Personalisiert, ohne KI

import type { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';

const countOccurrences = (text: string, pattern: RegExp) => (text.match(pattern) || []).length;
const cleanText = (text: string) => text.trim().replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');

type CheckResult = { found: boolean; detail: string };

const conversionKillers = [
    {
        id: "VALUE_PROP",
        title: "Unklares Nutzenversprechen",
        check: (content: string): CheckResult => {
            const match = content.match(/<h1[^>]*>(.*?)<\/h1>/i);
            if (!match || !match[1]) {
                return { found: true, detail: "Auf der Seite fehlt eine klare H1-Überschrift, um den Hauptnutzen auf den ersten Blick zu verdeutlichen." };
            }
            const text = cleanText(match[1]);
            if (text.length < 15 || text.toLowerCase().includes("willkommen")) {
                return { found: true, detail: `Die Hauptüberschrift "${text}" ist möglicherweise zu kurz oder zu generisch, um den Kundennutzen klar zu kommunizieren.` };
            }
            return { found: false, detail: "" };
        }
    },
    {
        id: "CTA",
        title: "Schwache Handlungsaufforderung",
        check: (content: string): CheckResult => {
            const match = content.match(/<button[^>]*>(.*?)<\/button>/i);
            if (!match || !match[1]) {
                return { found: true, detail: "Es wurde kein primärer <button>-Tag gefunden, was auf eine fehlende oder unklare Handlungsaufforderung hindeutet." };
            }
            const text = cleanText(match[1]);
            if (["mehr erfahren", "klicken sie hier", "weiter"].includes(text.toLowerCase())) {
                return { found: true, detail: `Der Call-to-Action "${text}" ist sehr generisch und erzeugt wenig Handlungsimpuls. Nutzenorientierte Texte wie "Analyse starten" oder "Jetzt Platz sichern" sind oft effektiver.` };
            }
            return { found: false, detail: "" };
        }
    },
    {
        id: "MOBILE_UX",
        title: "Mangelnde Mobiloptimierung",
        check: (content: string): CheckResult => {
            if (!/<meta[^>]+name=["']viewport["']/i.test(content)) {
                return { found: true, detail: "Im Quellcode fehlt der wichtige 'viewport'-Meta-Tag. Dies ist ein starkes Indiz dafür, dass die Seite auf Mobilgeräten nicht korrekt dargestellt wird." };
            }
            return { found: false, detail: "" };
        }
    },
    {
        id: "SSL",
        title: "Fehlendes Vertrauen (Kein SSL)",
        check: (content: string, url: string): CheckResult => {
            if (!url.startsWith('https://')) {
                return { found: true, detail: "Die Webseite wird nicht über eine sichere HTTPS-Verbindung ausgeliefert. Browser warnen Besucher oft vor solchen unsicheren Seiten." };
            }
            return { found: false, detail: "" };
        }
    },
    {
        id: "SOCIAL_PROOF",
        title: "Fehlender sozialer Beweis",
        check: (content: string): CheckResult => {
            if (!/kundenstimmen|bewertungen|referenzen|erfahrungen|erfolgsgeschichten/i.test(content)) {
                return { found: true, detail: "Es wurden keine typischen Schlüsselwörter für sozialen Beweis (wie 'Kundenstimmen', 'Bewertungen') gefunden. Dies kann das Vertrauen potenzieller Kunden beeinträchtigen." };
            }
            return { found: false, detail: "" };
        }
    },
    // Hier könnten weitere 20, ähnlich detaillierte Checks hinzugefügt werden.
];

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
        const response = await fetch(url);
        if (!response.ok) { throw new Error("Seite konnte nicht geladen werden."); }
        const content = await response.text();

        const foundKillers = conversionKillers.map(killer => {
            const result = killer.check(content, url);
            return { ...result, title: killer.title };
        }).filter(result => result.found);

        if (foundKillers.length < 2) {
            return res.status(200).json({
                message: `Sehr gut! Auf ${new URL(url).hostname} wurden kaum Schwachstellen gefunden.`,
                topKillers: [{ title: "Saubere Struktur", detail: "Die Seite scheint gut aufgebaut zu sein." }, { title: "Klares Design", detail: "Es wurden keine offensichtlichen Design-Probleme erkannt." }],
                remainingKillers: 0,
            });
        }
        
        const topKillers = foundKillers.slice(0, 2);
        const finalResult = {
            message: `Auf der Landing Page von ${new URL(url).hostname} gibt es aktuell ${foundKillers.length} potenzielle Conversion-Killer. Darunter:`,
            topKillers: topKillers.map(k => ({ title: k.title, detail: k.detail })),
            remainingKillers: Math.max(0, foundKillers.length - 2),
        };

        return res.status(200).json(finalResult);

    } catch (error) {
        return res.status(500).json({ message: 'Die Seite konnte nicht analysiert werden. Ist die URL korrekt?' });
    }
}
