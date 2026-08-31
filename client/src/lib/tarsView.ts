export type ConversazioneTarsView = {
  id: number;
  titolo: string;
  anteprima: string | null;
  fissata: boolean;
  archiviataAt: Date | string | null;
  updatedAt: Date | string;
};

export type GruppiConversazioniTars<T extends ConversazioneTarsView> = {
  fissate: T[];
  recenti: T[];
  archiviate: T[];
};

export type TurnoTarsView = {
  id: number;
  conversazioneId: number;
  ruolo: "utente" | "tars";
  contenuto: string;
  payload: Record<string, unknown> | null;
  createdAt: Date | string;
};

export type TurnoTarsOttimistico = {
  id: string;
  conversazioneId: number | null;
  ruolo: "utente";
  contenuto: string;
  payload: null;
  createdAt: Date;
  ottimistico: true;
  chiaveLocale: string;
  dopoTurnoId: number;
};

export type TurnoTarsVisualizzato = TurnoTarsView | TurnoTarsOttimistico;

export function filtraConversazioni<T extends ConversazioneTarsView>(
  conversazioni: readonly T[],
  ricerca: string
): T[] {
  const testo = ricerca.trim().toLocaleLowerCase("it-IT");
  if (!testo) return [...conversazioni];
  return conversazioni.filter(
    conversazione =>
      conversazione.titolo.toLocaleLowerCase("it-IT").includes(testo) ||
      conversazione.anteprima?.toLocaleLowerCase("it-IT").includes(testo)
  );
}

export function raggruppaConversazioni<T extends ConversazioneTarsView>(
  conversazioni: readonly T[]
): GruppiConversazioniTars<T> {
  const perAggiornamento = (a: T, b: T) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  const archiviate = conversazioni
    .filter(conversazione => conversazione.archiviataAt != null)
    .sort(perAggiornamento);
  const attive = conversazioni.filter(
    conversazione => conversazione.archiviataAt == null
  );
  return {
    fissate: attive
      .filter(conversazione => conversazione.fissata)
      .sort(perAggiornamento),
    recenti: attive
      .filter(conversazione => !conversazione.fissata)
      .sort(perAggiornamento),
    archiviate,
  };
}

type PartiData = { anno: number; mese: number; giorno: number };

function partiData(value: Date, timeZone: string): PartiData {
  const parti = new Intl.DateTimeFormat("it-IT", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(value);
  const numero = (tipo: Intl.DateTimeFormatPartTypes) =>
    Number(parti.find(parte => parte.type === tipo)?.value);
  return { anno: numero("year"), mese: numero("month"), giorno: numero("day") };
}

function giornoAssoluto(parti: PartiData): number {
  return Math.floor(
    Date.UTC(parti.anno, parti.mese - 1, parti.giorno) / 86_400_000
  );
}

export function etichettaTempoConversazione(
  value: Date | string,
  ora = new Date(),
  timeZone = "Europe/Rome"
): string {
  const data = new Date(value);
  if (Number.isNaN(data.getTime())) return "—";

  const secondi = (ora.getTime() - data.getTime()) / 1_000;
  if (secondi >= 0 && secondi < 60) return "Ora";

  const dataLocale = partiData(data, timeZone);
  const oraLocale = partiData(ora, timeZone);
  const giorni = giornoAssoluto(oraLocale) - giornoAssoluto(dataLocale);
  if (giorni === 0) {
    return new Intl.DateTimeFormat("it-IT", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(data);
  }
  if (giorni === 1) return "Ieri";
  return new Intl.DateTimeFormat("it-IT", {
    timeZone,
    day: "numeric",
    month: "short",
    ...(dataLocale.anno === oraLocale.anno ? {} : { year: "numeric" as const }),
  })
    .format(data)
    .replaceAll(".", "");
}

export function creaTurnoOttimistico(input: {
  chiaveLocale: string;
  conversazioneId: number | null;
  contenuto: string;
  createdAt?: Date;
  dopoTurnoId: number;
}): TurnoTarsOttimistico {
  return {
    id: `locale:${input.chiaveLocale}`,
    conversazioneId: input.conversazioneId,
    ruolo: "utente",
    contenuto: input.contenuto,
    payload: null,
    createdAt: input.createdAt ?? new Date(),
    ottimistico: true,
    chiaveLocale: input.chiaveLocale,
    dopoTurnoId: input.dopoTurnoId,
  };
}

export function unisciTurniConOttimistico(
  turniServer: readonly TurnoTarsView[],
  ottimistico: TurnoTarsOttimistico | null
): TurnoTarsVisualizzato[] {
  if (!ottimistico) return [...turniServer];
  const arrivatoDalServer = turniServer.some(
    turno =>
      turno.id > ottimistico.dopoTurnoId &&
      turno.ruolo === "utente" &&
      turno.contenuto.trim() === ottimistico.contenuto.trim() &&
      (ottimistico.conversazioneId == null ||
        turno.conversazioneId === ottimistico.conversazioneId)
  );
  return arrivatoDalServer ? [...turniServer] : [...turniServer, ottimistico];
}

export function deveInviareDaTastiera(evento: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
}): boolean {
  return evento.key === "Enter" && !evento.shiftKey && !evento.isComposing;
}
