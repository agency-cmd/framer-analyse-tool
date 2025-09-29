// /api/analyze.ts
// FINALE VERSION (Experten-Engine v3.2) - Mit angepassten 70/100 Schwellenwerten

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
    const cleanText = (text: string) => text ? text.trim().replace(/<[^>]+>/g, '').replace(/\s+/g, ' ') : '';
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
        if (content.indexOf(h1Match[0]) > content.length * 0.4) {
             found.push({ title: "Nutzenversprechen nicht sofort sichtbar", detail: "Die Hauptüberschrift (H1) erscheint erst sehr weit unten auf der Seite und ist nicht 'above the fold' sichtbar." });
        }
    }

    const titleMatch = content.match(/<title[^>]*>(.*?)<\/title>/i);
    if (!titleMatch || !titleMatch[1] || cleanText(titleMatch[1]).length < 15) {
        found.push({ title: "Fehlender oder schwacher Seitentitel", detail: "Der Seitentitel (im Browser-Tab sichtbar) fehlt oder ist zu kurz. Er ist entscheidend für SEO und Wiedererkennung." });
    }

    if (!/<meta[^>]+name=["']description["']/i.test(content)) {
        found.push({ title: "Fehlende Meta-Beschreibung", detail: "Die Meta-Beschreibung für Suchmaschinen fehlt. Eine riesige verpasste Chance, Nutzer zum Klicken zu animieren." });
    }
    
    if (cleanText(bodyContent).length < 350) {
        found.push({ title: "Geringer Informationsgehalt (Thin Content)", detail: `Die Seite enthält mit ca. ${cleanText(bodyContent).split(' ').length} Wörtern sehr wenig Text, was auf inhaltliche Schwächen hindeuten kann.` });
    }

    // --- GRUPPE: HANDLUNGSAUFFORDERUNG (CTA) ---
    let ctaFound = false;
    let ctaText = "";
    const buttonMatch = bodyContent.match(/<button[^>]*>(.*?)<\/button>/i);
    if (buttonMatch && buttonMatch[1]) { ctaFound = true; ctaText = cleanText(buttonMatch[1]); }
    if (!ctaFound) {
        const linkButtonMatch = bodyContent.match(/<a[^>]*class=["'][^"']*(?:button|btn|cta)[^"']*["'][^>]*>(.*?)<\/a>/i);
        if (linkButtonMatch && linkButtonMatch[1]) { ctaFound = true; ctaText = cleanText(linkButtonMatch[1]); }
    }
    if (!ctaFound) {
        const roleButtonMatch = bodyContent.match(/<[^>]+role=["']button["'][^>]*>(.*?)<\/[^>]+>/i);
        if (roleButtonMatch && roleButtonMatch[1]) { ctaFound = true; ctaText = cleanText(roleButtonMatch[1]); }
    }
    if (!ctaFound) {
        found.push({ title: "Fehlender Call-to-Action", detail: "Es konnte kein klares CTA-Element (weder <button> noch ein als Button gestalteter Link) gefunden werden." });
    } else {
        if (["mehr erfahren", "klicken sie hier", "weiter", "absenden"].includes(ctaText.toLowerCase())) {
            found.push({ title: "Generischer Call-to-Action Text", detail: `Der primäre Call-to-Action "${ctaText}" ist sehr generisch. Ein handlungsorientierter, spezifischer Text wäre überzeugender.` });
        }
    }
    
    if (!/jetzt|sofort|angebot|nur für kurze zeit|zeitlich begrenzt/i.test(bodyContent)) {
         found.push({ title: "Fehlender Handlungsimpuls", detail: "Es wurden keine Dringlichkeit erzeugenden Wörter (z.B. 'Jetzt', 'Angebot endet') gefunden, die den Nutzer zum sofortigen Handeln motivieren." });
    }

    // --- GRUPPE: VERTRAUEN & GLAUBWÜRDIGKEIT ---
    if (!url.startsWith('https://')) {
        found.push({ title: "Unsichere Verbindung (Kein SSL)", detail: "Die Webseite wird nicht über eine sichere HTTPS-Verbindung ausgeliefert, was Browser oft als unsicher markieren." });
    }

    if (!/<a[^>]*href=["'][^"']*impressum[^"']*["'][^>]*>.*?impressum.*?<\/a>/i.test(bodyContent)) {
        found.push({ title: "Fehlendes Impressum", detail: "Ein klar verlinktes Impressum wurde nicht gefunden. In der DACH-Region ist dies rechtlich erforderlich und schafft Vertrauen." });
    }
    
    if (!/<a[^>]*href=["'][^"']*(?:datenschutz|privacy)[^"']*["'][^>]*>.*?datenschutz.*?<\/a>/i.test(bodyContent)) {
        found.push({ title: "Fehlende Datenschutzerklärung", detail: "Ein klar verlinkter Hinweis zur Datenschutzerklärung ist nach DSGVO Pflicht und ein wichtiges Vertrauenssignal." });
    }

    const yearMatch = bodyContent.match(/©\s*(\d{4})/);
    const currentYear = new Date().getFullYear();
    if (yearMatch && parseInt(yearMatch[1]) < currentYear) {
        found.push({ title: "Veraltetes Copyright-Jahr", detail: `Das Copyright-Jahr "${yearMatch[1]}" ist nicht aktuell (aktuelles Jahr: ${currentYear}). Dies kann signalisieren, dass die Seite nicht mehr aktiv gepflegt wird.` });
    }
    
    if (!/kundenstimmen|bewertungen|referenzen|erfahrungen|case\s?stud|was unsere kunden sagen/i.test(bodyContent)) {
        found.push({ title: "Fehlender sozialer Beweis", detail: "Es wurden keine Schlüsselwörter für sozialen Beweis (wie 'Kundenstimmen', 'Bewertungen') gefunden, was das Vertrauen beeinträchtigen kann." });
    }

    if (!/garantie|risikofrei|geld-zurück|kostenlos testen|sicher/i.test(bodyContent)) {
        found.push({ title: "Fehlende Garantien / Trust Signals", detail: "Es wurden keine risikomindernden Elemente (z.B. 'Geld-zurück-Garantie', 'sicher') gefunden, die Kauf- oder Kontakthürden abbauen." });
    }
    
    if (url.startsWith('http://') && /<input[^>]+type=["']password["']/i.test(bodyContent)) {
        found.push({ title: "Unsichere Passwort-Eingabe", detail: "Die Seite verfügt über ein Passwortfeld, wird aber ungesichert via HTTP ausgeliefert. Das ist ein großes Sicherheitsrisiko." });
    }

    // --- GRUPPE: INTERAKTION & DESIGN ---
    const inputCount = (content.match(/<input/g) || []).length;
    if (inputCount > 5) {
        found.push({ title: "Langes Formular", detail: `Die Seite enthält ein Formular mit ${inputCount} Feldern, was für Nutzer eine hohe Hürde darstellen kann.` });
    }

    if (/<video[^>]+autoplay/i.test(content) || /<audio[^>]+autoplay/i.test(content)) {
        found.push({ title: "Automatisch startende Medien", detail: "Mindestens ein Video oder Audio-Element startet automatisch, was von vielen Nutzern als störend empfunden wird." });
    }

    const fontFamilies = new Set(content.match(/font-family:\s*([^;\}]+)/g));
    if (fontFamilies.size > 3) {
        found.push({ title: "Visuelle Unruhe durch Schriftarten", detail: `Es wurden ${fontFamilies.size} verschiedene Schriftarten-Definitionen gefunden. Mehr als 2-3 können unprofessionell und unruhig wirken.` });
    }
    
    const navLinks = (content.match(/<nav[^>]*>.*?(<a)/g) || []).length;
    if (navLinks > 8) {
        found.push({ title: "Überladene Navigation", detail: `Die Navigation enthält mit ${navLinks} Links sehr viele Optionen, was die Nutzerführung erschweren kann.` });
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

        const perfScore = lighthouse.categories.performance.score * 100;
        // ***ANGEPASSTE REGEL: Schwelle bei 70 statt 90***
        if (perfScore < 70) {
            const detailText = perfScore < 50 
                ? `Die mobile Performance ist mit einem Score von ${Math.round(perfScore)}/100 kritisch und eine der größten Conversion-Bremsen.`
                : `Die mobile Performance ist mit ${Math.round(perfScore)}/100 mäßig. Eine Optimierung auf über 70 wird dringend empfohlen.`;
            found.push({ title: "Verbesserungswürdige Ladezeit", detail: detailText });
        }

        if (audits['viewport']?.score !== 1) {
             found.push({ title: "Mangelnde Mobiloptimierung", detail: "Der wichtige 'viewport'-Meta-Tag fehlt oder ist fehlerhaft. Dies führt zu einer schlechten Darstellung auf Smartphones." });
        }
        
        const accessScore = lighthouse.categories.accessibility.score * 100;
        // ***ANGEPASSTE REGEL: Schwelle bei 70 statt 90***
        if (accessScore < 70) {
            found.push({ title: "Mangelnde Barrierefreiheit", detail: `Der Accessibility-Score ist mit ${Math.round(accessScore)}/100 niedrig. Probleme wie zu geringe Kontraste oder fehlende Bildbeschreibungen schließen Nutzer aus.` });
        }
        
        if (audits['image-alt']?.score !== 1) {
            found.push({ title: "Fehlende Bildbeschreibungen (Alt-Texte)", detail: "Wichtigen Bildern fehlen Alternativtexte. Das schadet der Barrierefreiheit (Screenreader) und SEO." });
        }
        
        if (audits['uses-optimized-images']?.details?.overallSavingsBytes > 100000) {
             found.push({ title: "Nicht optimierte Bilder", detail: "Die Bilder auf der Seite sind nicht ausreichend komprimiert und verlangsamen die Ladezeit unnötig." });
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

        let topKillersToShow;
        let messageText;

        if (allKillers.length < 5) {
            topKillersToShow = allKillers.slice(0, 1);
            messageText = `Auf der Landing Page von ${new URL(url).hostname} gibt es aktuell ${allKillers.length} potenzielle Conversion-Killer. Der wichtigste ist:`
        } else {
            topKillersToShow = allKillers.slice(0, 2);
            messageText = `Auf der Landing Page von ${new URL(url).hostname} gibt es aktuell ${allKillers.length} potenzielle Conversion-Killer. Darunter:`
        }

        const finalResult = {
            message: messageText,
            topKillers: topKillersToShow,
            remainingKillers: Math.max(0, allKillers.length - topKillersToShow.length),
        };
        
        return res.status(200).json(finalResult);

    } catch (error) {
        console.error("Handler Error:", error);
        return res.status(500).json({ message: 'Die Seite konnte nicht analysiert werden. Ist die URL korrekt und öffentlich erreichbar?' });
    }
}
