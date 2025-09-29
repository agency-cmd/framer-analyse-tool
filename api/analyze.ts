// /api/analyze.ts
// FINALE VERSION (Präzisions-Engine v1.2) - Personalisiert, ohne KI, mehr Checks

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
    const bodyContent = content.match(/<body[^>]*>(.*?)<\/body>/is)?.[1] || content;

    // --- GRUPPE: INHALT & STRUKTUR ---
    const h1Match = bodyContent.match(/<h1[^>]*>(.*?)<\/h1>/i);
    if (!h1Match || !h1Match[1]) {
        found.push({ title: "Fehlendes Nutzenversprechen (H1)", detail: "Auf der Seite fehlt eine klare H1-Überschrift, um den Hauptnutzen auf den ersten Blick zu verdeutlichen." });
    } else {
        const text = cleanText(h1Match[1]);
        if (text.length < 15 || text.toLowerCase().includes("willkommen")) {
            found.push({ title: "Schwaches Nutzenversprechen (H1)", detail: `Die Hauptüberschrift "${text}" ist möglicherweise zu kurz oder zu generisch, um den Kundennutzen klar zu kommunizieren.` });
        }
        // Tiefen-Check - Ist die H1 weit unten?
        if (content.indexOf(h1Match[0]) > content.length * 0.4) {
             found.push({ title: "Nutzenversprechen nicht sofort sichtbar", detail: "Die Hauptüberschrift (H1) erscheint erst sehr weit unten auf der Seite und ist nicht 'above the fold' sichtbar." });
        }
    }

    const titleMatch = content.match(/<title[^>]*>(.*?)<\/title>/i);
    if (!titleMatch || !titleMatch[1] || cleanText(titleMatch[1]).length < 10) {
        found.push({ title: "Fehlender oder schwacher Seitentitel", detail: "Der Seitentitel (im Browser-Tab sichtbar) fehlt oder ist zu kurz. Er ist entscheidend für SEO und Wiedererkennung." });
    }

    if (!/<meta[^>]+name=["']description["']/i.test(content)) {
        found.push({ title: "Fehlende Meta-Beschreibung", detail: "Die Meta-Beschreibung für Suchmaschinen fehlt. Eine riesige verpasste Chance, Nutzer zum Klicken zu animieren." });
    }

    // --- GRUPPE: HANDLUNGSAUFFORDERUNG (CTA) ---
    const buttonMatch = bodyContent.match(/<button[^>]*>(.*?)<\/button>/ig); // 'g' flag to find all buttons
    if (!buttonMatch || buttonMatch.length === 0) {
        found.push({ title: "Fehlender Call-to-Action Button", detail: "Es wurde kein primärer <button>-Tag gefunden. Ein klarer Call-to-Action ist entscheidend für die Conversion." });
    } else {
        const genericCTAs = buttonMatch.filter(btn => {
            const text = cleanText(btn);
            return ["mehr erfahren", "klicken sie hier", "weiter", "absenden"].includes(text.toLowerCase());
        });
        if (genericCTAs.length > 0) {
            found.push({ title: "Generische Call-to-Action Texte", detail: `Mindestens ein Button verwendet einen generischen Text wie "${cleanText(genericCTAs[0])}". Nutzenorientierte Texte sind oft effektiver.` });
        }
    }

    // --- GRUPPE: VERTRAUEN & GLAUBWÜRDIGKEIT ---
    if (!url.startsWith('https://')) {
        found.push({ title: "Unsichere Verbindung (Kein SSL)", detail: "Die Webseite wird nicht über eine sichere HTTPS-Verbindung ausgeliefert, was Browser oft als unsicher markieren." });
    }

    if (!/impressum/i.test(bodyContent)) {
        found.push({ title: "Fehlendes Impressum", detail: "Es wurde kein Link oder Hinweis auf ein Impressum gefunden, was in der DACH-Region rechtlich erforderlich ist und Vertrauen schafft." });
    }
    
    if (!/datenschutz|privacy/i.test(bodyContent)) {
        found.push({ title: "Fehlende Datenschutzerklärung", detail: "Ein Link zur Datenschutzerklärung ist nach DSGVO Pflicht und ein wichtiges Vertrauenssignal für Besucher." });
    }

    const yearMatch = bodyContent.match(/©\s*(\d{4})/);
    const currentYear = new Date().getFullYear();
    if (yearMatch && parseInt(yearMatch[1]) < currentYear) {
        found.push({ title: "Veraltetes Copyright-Jahr", detail: `Das Copyright-Jahr "${yearMatch[1]}" ist nicht aktuell (aktuelles Jahr: ${currentYear}). Dies kann signalisieren, dass die Seite nicht mehr aktiv gepflegt wird.` });
    }
    
    if (!/kundenstimmen|bewertungen|referenzen|erfahrungen/i.test(bodyContent)) {
        found.push({ title: "Fehlender sozialer Beweis", detail: "Es wurden keine Schlüsselwörter für sozialen Beweis (wie 'Kundenstimmen', 'Bewertungen') gefunden, was das Vertrauen beeinträchtigen kann." });
    }
    
    // --- GRUPPE: FORMULARE & INTERAKTION ---
    const inputCount = (content.match(/<input/g) || []).length;
    if (inputCount > 6) {
        found.push({ title: "Langes Formular", detail: `Das Formular auf der Seite hat mit ${inputCount} Feldern eine hohe Hürde. Jedes Feld erhöht die Abbruchwahrscheinlichkeit.` });
    }

    if (/<video[^>]+autoplay/i.test(content) || /<audio[^>]+autoplay/i.test(content)) {
        found.push({ title: "Automatisch startende Medien", detail: "Mindestens ein Video oder Audio-Element startet automatisch, was von vielen Nutzern als störend empfunden wird." });
    }

    const fontFamilies = new Set(content.match(/font-family:\s*([^;\}]+)/g));
    if (fontFamilies.size > 4) {
        found.push({ title: "Visuelle Unruhe durch zu viele Schriftarten", detail: `Es wurden ${fontFamilies.size} verschiedene Schriftarten-Definitionen gefunden. Mehr als 2-3 können unprofessionell und unruhig wirken.` });
    }

    return found;
};

// --- PAGESPEED-CHECKS (Der technische Prüfer) ---
const runPageSpeedChecks = async (url: string): Promise<Killer[]> => {
    const found: Killer[] = [];
    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&key=${PAGESPEED_API_KEY}&strategy=mobile&category=performance&category=accessibility&category=best-practices`;

    try {
        const response = await fetch(apiUrl);
        if (!response.ok) return found;
        const data = await response.json();
        const lighthouse = data.lighthouseResult;
        const audits = lighthouse.audits;

        // Performance
        const perfScore = lighthouse.categories.performance.score * 100;
        if (perfScore < 50) {
            found.push({ title: "Langsame Ladezeiten", detail: `Die mobile Performance ist mit einem Score von ${Math.round(perfScore)}/100 kritisch. Langsame Seiten führen zu hohen Absprungraten.` });
        } else if (perfScore < 90) {
            found.push({ title: "Mäßige Ladezeiten", detail: `Die mobile Performance ist mit ${Math.round(perfScore)}/100 verbesserungswürdig. Schnellere Ladezeiten verbessern die Nutzererfahrung deutlich.` });
        }

        // Responsivität / Viewport
        if (audits['viewport']?.score !== 1) {
             found.push({ title: "Mangelnde Mobiloptimierung", detail: "Der wichtige 'viewport'-Meta-Tag fehlt oder ist fehlerhaft. Dies führt zu einer schlechten Darstellung auf Smartphones." });
        }
        
        // Accessibility (Barrierefreiheit)
        const accessScore = lighthouse.categories.accessibility.score * 100;
        if (accessScore < 80) {
            found.push({ title: "Mangelnde Barrierefreiheit", detail: `Der Accessibility-Score ist mit ${Math.round(accessScore)}/100 niedrig. Probleme wie zu geringe Kontraste schließen Nutzer aus.` });
        }
        
        // Fehlende Bildbeschreibungen
        if (audits['image-alt']?.score !== 1) {
            found.push({ title: "Fehlende Bildbeschreibungen (Alt-Texte)", detail: "Wichtigen Bildern fehlen Alternativtexte. Das schadet der Barrierefreiheit (Screenreader) und SEO." });
        }
        
        // Nicht optimierte Bilder
        if (audits['uses-optimized-images']?.score !== 1 && audits['uses-optimized-images']?.details?.overallSavingsBytes > 50000) {
             found.push({ title: "Nicht optimierte Bilder", detail: "Die Bilder auf der Seite sind nicht optimal komprimiert und verlangsamen die Ladezeit unnötig." });
        }

        return found;
    } catch (e) {
        console.error("PageSpeed API Error:", e);
        return found;
    }
};

// --- HAUPTFUNKTION (HANDLER) ---
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
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
        console.error("Handler Error:", error);
        return res.status(500).json({ message: 'Die Seite konnte nicht analysiert werden. Ist die URL korrekt und öffentlich erreichbar?' });
    }
}
