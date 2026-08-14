import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Eye, EyeOff, LogIn } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const utils = trpc.useUtils();
  const prefersReducedMotion = useReducedMotion();

  const login = trpc.auth.login.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
    },
    onError: (err) => {
      setError(err.message || "Credenziali non valide");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email || !password) {
      setError("Inserisci email e password");
      return;
    }
    login.mutate({ email, password });
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,var(--primary),var(--color-accent-brand),var(--chart-5))]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 hidden w-[34vw] border-r border-border bg-card lg:block"
        style={{
          backgroundImage:
            "linear-gradient(145deg, var(--color-accent-soft), var(--card) 60%, var(--color-info-soft))",
        }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,transparent_0%,transparent_62%,color-mix(in_srgb,var(--color-accent-brand)_10%,transparent)_62%,transparent_82%)]" />

      <div className="relative z-10 flex min-h-screen items-center justify-center p-4">
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.36, ease: [0.25, 1, 0.5, 1] }}
          className="max-w-[420px]"
          style={{ width: "min(420px, calc(100vw - 5rem))" }}
        >
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.28 }}
            className="mb-5 text-center space-y-3"
          >
            <img
              src="/logo.svg"
              alt="Ruffino Group"
              className="mx-auto h-11 drop-shadow-sm"
            />
            <div className="space-y-1">
              <h1 className="font-display text-[30px] font-extrabold leading-tight">
                Ruffino Flow
              </h1>
              <p className="eyebrow !text-text-2">Gestionale commesse infissi</p>
            </div>
          </motion.div>

          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.3 }}
            className="relative overflow-hidden rounded-xl border border-border/80 bg-card p-6 shadow-lg"
          >
            <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,var(--primary),var(--color-accent-brand))]" />
            <h2 className="mb-4 text-lg font-semibold">Accedi</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={prefersReducedMotion ? false : { opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.18 }}
                    role="alert"
                    className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
                  >
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="nome@ruffinogroup.it"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  autoFocus
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Inserisci password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className="h-11 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={showPassword ? "Nascondi password" : "Mostra password"}
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span
                        key={showPassword ? "off" : "on"}
                        initial={{ opacity: 0, rotate: -45 }}
                        animate={{ opacity: 1, rotate: 0 }}
                        exit={{ opacity: 0, rotate: 45 }}
                        transition={{ duration: 0.15 }}
                        className="block"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </motion.span>
                    </AnimatePresence>
                  </button>
                </div>
              </div>

              <motion.div whileTap={prefersReducedMotion ? undefined : { scale: 0.995 }}>
                <Button
                  type="submit"
                  className="h-11 w-full"
                  disabled={login.isPending}
                >
                  {login.isPending ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                      Accesso in corso…
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <LogIn className="h-4 w-4" />
                      Accedi
                    </span>
                  )}
                </Button>
              </motion.div>
            </form>
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.4 }}
            className="mt-4 text-center text-[11px] text-muted-foreground"
          >
            © {new Date().getFullYear()} Ruffino Immobiliare S.R.L.
          </motion.p>
        </motion.div>
      </div>
    </div>
  );
}
