import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Settings,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Calendar,
  ListTodo,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";

export default function Integrazioni() {
  // Integration states (would be persisted in real app)
  const [todoEnabled, setTodoEnabled] = useState(false);
  const [calendarEnabled, setCalendarEnabled] = useState(false);
  const [todoConfig, setTodoConfig] = useState({
    clientId: "",
    tenantId: "",
    autoCreateTasks: true,
    syncBidirectional: true,
    defaultList: "Ruffino Cartelléttà",
  });
  const [calendarConfig, setCalendarConfig] = useState({
    clientId: "",
    calendarId: "",
    colorCoding: true,
    autoAssignSquadre: true,
    syncBidirectional: true,
  });

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Settings className="h-6 w-6" />
          Integrazioni
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Configura le integrazioni con servizi esterni
        </p>
      </div>

      {/* Microsoft To Do */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <ListTodo className="h-5 w-5 text-blue-700" />
              </div>
              <div>
                <CardTitle className="text-base">Microsoft To Do</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Sincronizzazione task operativi bidirezionale
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {todoEnabled ? (
                <Badge className="text-xs bg-green-100 text-green-800 hover:bg-green-100">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Attiva
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-xs">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  Non configurata
                </Badge>
              )}
              <Switch checked={todoEnabled} onCheckedChange={setTodoEnabled} />
            </div>
          </div>
        </CardHeader>
        {todoEnabled && (
          <CardContent className="space-y-4 border-t pt-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Client ID (Azure AD)</Label>
                <Input
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={todoConfig.clientId}
                  onChange={(e) =>
                    setTodoConfig({ ...todoConfig, clientId: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Tenant ID</Label>
                <Input
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={todoConfig.tenantId}
                  onChange={(e) =>
                    setTodoConfig({ ...todoConfig, tenantId: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Lista predefinita</Label>
              <Input
                value={todoConfig.defaultList}
                onChange={(e) =>
                  setTodoConfig({ ...todoConfig, defaultList: e.target.value })
                }
              />
            </div>
            <Separator />
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Comportamento
              </h4>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Creazione automatica task</p>
                  <p className="text-xs text-muted-foreground">
                    Crea task su To Do alla creazione di interventi, anomalie e ticket
                  </p>
                </div>
                <Switch
                  checked={todoConfig.autoCreateTasks}
                  onCheckedChange={(v) =>
                    setTodoConfig({ ...todoConfig, autoCreateTasks: v })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Sincronizzazione bidirezionale</p>
                  <p className="text-xs text-muted-foreground">
                    Completando il task su To Do, lo stato si aggiorna nell'app
                  </p>
                </div>
                <Switch
                  checked={todoConfig.syncBidirectional}
                  onCheckedChange={(v) =>
                    setTodoConfig({ ...todoConfig, syncBidirectional: v })
                  }
                />
              </div>
            </div>
            <Separator />
            <div className="flex items-center gap-3">
              <Button size="sm" disabled={!todoConfig.clientId}>
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                Autorizza con Microsoft
              </Button>
              <Button variant="outline" size="sm" disabled={!todoConfig.clientId}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                Test connessione
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Richiede un'app registrata su Azure Active Directory con permessi Tasks.ReadWrite.
              Il token verrà gestito in modo sicuro dal server con refresh automatico.
            </p>
          </CardContent>
        )}
      </Card>

      {/* Google Calendar */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
                <Calendar className="h-5 w-5 text-green-700" />
              </div>
              <div>
                <CardTitle className="text-base">Google Calendar</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Pianificazione appuntamenti e sincronizzazione eventi
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {calendarEnabled ? (
                <Badge className="text-xs bg-green-100 text-green-800 hover:bg-green-100">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Attiva
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-xs">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  Non configurata
                </Badge>
              )}
              <Switch
                checked={calendarEnabled}
                onCheckedChange={setCalendarEnabled}
              />
            </div>
          </div>
        </CardHeader>
        {calendarEnabled && (
          <CardContent className="space-y-4 border-t pt-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Client ID (Google Cloud)</Label>
                <Input
                  placeholder="xxxxx.apps.googleusercontent.com"
                  value={calendarConfig.clientId}
                  onChange={(e) =>
                    setCalendarConfig({
                      ...calendarConfig,
                      clientId: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Calendar ID</Label>
                <Input
                  placeholder="primary o ID specifico"
                  value={calendarConfig.calendarId}
                  onChange={(e) =>
                    setCalendarConfig({
                      ...calendarConfig,
                      calendarId: e.target.value,
                    })
                  }
                />
              </div>
            </div>
            <Separator />
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Comportamento
              </h4>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Codifica a colori</p>
                  <p className="text-xs text-muted-foreground">
                    Usa i colori di Calendar per distinguere rilievi, pose e assistenza
                  </p>
                </div>
                <Switch
                  checked={calendarConfig.colorCoding}
                  onCheckedChange={(v) =>
                    setCalendarConfig({ ...calendarConfig, colorCoding: v })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Assegnazione automatica squadre</p>
                  <p className="text-xs text-muted-foreground">
                    Aggiunge eventi al calendario dei membri della squadra assegnata
                  </p>
                </div>
                <Switch
                  checked={calendarConfig.autoAssignSquadre}
                  onCheckedChange={(v) =>
                    setCalendarConfig({
                      ...calendarConfig,
                      autoAssignSquadre: v,
                    })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Sincronizzazione bidirezionale</p>
                  <p className="text-xs text-muted-foreground">
                    Spostando un evento in Calendar, la data si aggiorna nell'app
                  </p>
                </div>
                <Switch
                  checked={calendarConfig.syncBidirectional}
                  onCheckedChange={(v) =>
                    setCalendarConfig({
                      ...calendarConfig,
                      syncBidirectional: v,
                    })
                  }
                />
              </div>
            </div>
            <Separator />
            <div className="flex items-center gap-3">
              <Button size="sm" disabled={!calendarConfig.clientId}>
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                Autorizza con Google
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!calendarConfig.clientId}
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                Test connessione
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Richiede un progetto Google Cloud con Calendar API abilitata e credenziali OAuth 2.0.
              L'evento includera descrizione, contatti cliente e indirizzo navigabile con Maps.
            </p>
          </CardContent>
        )}
      </Card>

      {/* Info */}
      <Card className="bg-muted/30">
        <CardContent className="p-4">
          <h4 className="text-sm font-semibold mb-2">Come funzionano le integrazioni</h4>
          <div className="space-y-2 text-xs text-muted-foreground">
            <p>
              <strong>Microsoft To Do:</strong> Alla creazione di un intervento, anomalia o ticket,
              viene generato un task con deep link alla risorsa. Le checklist di posa vengono
              mappate come sotto-task. Lo stato si sincronizza in entrambe le direzioni.
            </p>
            <p>
              <strong>Google Calendar:</strong> Alla pianificazione di un intervento, viene creato
              un evento con dettagli completi (descrizione, contatti cliente, indirizzo navigabile).
              Gli eventi sono colorati per tipo (rilievo, posa, assistenza). Le modifiche su Calendar
              si propagano all'app tramite webhook.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
