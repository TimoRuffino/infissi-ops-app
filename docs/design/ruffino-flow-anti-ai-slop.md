# Frame & Flow — Gate anti-AI-slop

> **Direzione estetica superata (31/08/2026).** Questo gate conserva valore
> storico e le regole anti-decorazione compatibili, ma la direzione visuale e
> i criteri di firma sono ora definiti dal master prompt v3 “Modular Control /
> Borgogna Operativa”. In caso di conflitto prevale il master prompt v3.

> Requisito di accettazione, non consiglio. Una schermata fallisce se,
> cambiando logo e nome, potrebbe appartenere a cento dashboard generate.
> Ogni revisione (autocritica sulle golden screens + revisione finale
> dedicata) passa da questo documento.

## 1. Blacklist visuale (vietato salvo deroga scritta e approvata)

Gradienti viola/blu-ciano/rosa e mesh decorativi · aurora/glow/blob/orb ·
3D gratuito · illustrazioni generate o stock · glassmorphism e backdrop
blur su superfici grandi · bento grid universale · card dentro card ·
radius 20–24 ovunque · ombre profonde senza gerarchia · hero da landing ·
titoli enormi nel gestionale · 4 KPI fotocopia su ogni dashboard · donut
decorativi · grafici senza domanda operativa · metriche inventate · dati
finti in produzione · lorem ipsum · emoji come icone · microcopy inglese ·
«AI-powered»/«sblocca la potenza» · badge arcobaleno · avatar finti ·
pattern di puntini · tutto animato all'ingresso · stagger infinito · hover
lift su qualsiasi contenitore · `rounded-2xl shadow-xl` per abitudine ·
palette/spacing hardcoded nelle pagine · componenti duplicati con varianti
casuali.

**Eredità v1 che ricade nella blacklist e la v2 spegne:** i quattro
`--gradient-*` (pagina, sidebar, primary, soft) e l'attivo di sidebar a
gradiente. Sono decorazione senza razionale: via sotto flag.

## 2. Blacklist Tars

Niente bolla flottante, orb, viola/ciano, robot, volto, sparkles, apertura
automatica, typing dots vuoti, pulsanti «magici», suggerimenti travestiti
da dati confermati, azioni senza fonte, chain-of-thought, token annunciati
uno a uno agli screen reader. Tars = ink + giallo segnale + rail + label
«Tars» + provenienza. Il pulse è ammesso solo durante attività reale
dichiarata dal server.

## 3. Test umano (per ogni schermata migrata)

1. Quale lavoro reale aiuta? 2. Quale informazione merita più attenzione?
3. Cosa appartiene specificamente agli infissi? 4. Cosa è strutturale e
cosa decorativo? 5. Perché esiste ogni card? 6. Ogni colore? 7. Ogni
animazione? 8. Avrebbe senso identica in un gestionale palestre? (se sì:
bocciata) 9. Unità, stati e riferimenti sono quelli reali del dominio?
10. Sembra disegnata o generata?

## 4. Dati realistici nelle fixture

Codici commessa (`COM-2026-xxx`), date rilievo/posa Europe/Rome, misure in
mm, m², tipologie serramento (scorrevole alzante, persiana, blindato…),
vetri (33.1/15/33.1 basso emissivo), finiture RAL, fornitori plausibili,
conferme d'ordine, quantità ordinate/ricevute parziali, pagamenti con
residuo, gli 11 stati veri, riferimenti documentali. Fixture chiaramente
separate dalla produzione, mai PII reale negli artifact.

## 5. Deroghe scritte (le uniche ammesse)

Il test `client/src/lib/tokenDiscipline.test.ts` fa rispettare le regole di
colore e conosce solo queste eccezioni:

| Deroga | Dove | Perché |
|---|---|---|
| Verde WhatsApp `#25D366` | `WhatsAppCard.tsx`, `WhatsAppButton.tsx` | colore di un marchio di terze parti: non appartiene al nostro sistema e non deve seguirne il tema |
| Palette avatar chat | `ChatAziendale.tsx` | sei tinte scure fisse per le iniziali: identità delle persone, leggibili in entrambi i temi |
| Residui Manus | `ManusDialog.tsx`, `AIChatBox.tsx` | componenti senza alcun consumatore (zero import): la loro rimozione è una decisione a sé, non una modifica di skin |

Ogni altra classe di colore arbitraria o `text-white` sopra un pieno
semantico fa fallire la suite: si usano i token, o si aggiunge una riga qui
con la ragione.

## 6. Domande della revisione finale anti-slop

Le cinque famiglie di pagina hanno silhouette diverse? · Scambiabile per
Base44/Linear/Attio? · Pattern generici senza relazione col dominio? ·
Card superflue? · Animazioni decorative? · Tars sembra un chatbot? · Il
giallo è troppo? (una dominante per schermata) · Il dark sembra invertito
o progettato? · Le pagine operative sono dense quanto serve? · Il mobile è
davvero operativo in cantiere?
