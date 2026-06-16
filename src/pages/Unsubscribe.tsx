import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2, XCircle, MailX } from "lucide-react";

type Status = "loading" | "valid" | "already" | "invalid" | "confirming" | "success" | "error";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const Unsubscribe = () => {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`,
          { headers: { apikey: SUPABASE_ANON_KEY } },
        );
        const data = await res.json();
        if (!res.ok) {
          setStatus("invalid");
          setErrorMsg(data?.error ?? "Lien invalide");
          return;
        }
        if (data.valid === false && data.reason === "already_unsubscribed") {
          setStatus("already");
        } else if (data.valid === true) {
          setStatus("valid");
        } else {
          setStatus("invalid");
        }
      } catch (e) {
        setStatus("invalid");
        setErrorMsg(e instanceof Error ? e.message : "Erreur réseau");
      }
    })();
  }, [token]);

  const confirm = async () => {
    if (!token) return;
    setStatus("confirming");
    try {
      const { data, error } = await supabase.functions.invoke("handle-email-unsubscribe", {
        body: { token },
      });
      if (error) throw error;
      if (data?.success) setStatus("success");
      else if (data?.reason === "already_unsubscribed") setStatus("already");
      else setStatus("error");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "Erreur");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md rounded-3xl shadow-xl">
        <CardHeader className="text-center space-y-2">
          <div className="flex justify-center">
            <MailX className="h-10 w-10 text-primary" />
          </div>
          <CardTitle className="font-montserrat text-2xl">Désabonnement GOURЯMET</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center font-poppins">
          {status === "loading" && (
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Vérification du lien…
            </div>
          )}

          {status === "valid" && (
            <>
              <p>Confirmez-vous votre désabonnement de nos communications ?</p>
              <Button onClick={confirm} className="w-full rounded-2xl">
                Confirmer le désabonnement
              </Button>
            </>
          )}

          {status === "confirming" && (
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Traitement en cours…
            </div>
          )}

          {status === "success" && (
            <div className="space-y-2">
              <CheckCircle2 className="h-10 w-10 text-primary mx-auto" />
              <p>Votre désabonnement a bien été pris en compte.</p>
              <p className="text-sm text-muted-foreground">
                Vous ne recevrez plus de communications de notre part.
              </p>
            </div>
          )}

          {status === "already" && (
            <div className="space-y-2">
              <CheckCircle2 className="h-10 w-10 text-primary mx-auto" />
              <p>Vous êtes déjà désabonné·e.</p>
            </div>
          )}

          {(status === "invalid" || status === "error") && (
            <div className="space-y-2">
              <XCircle className="h-10 w-10 text-destructive mx-auto" />
              <p>
                {status === "invalid"
                  ? "Ce lien de désabonnement est invalide ou expiré."
                  : "Une erreur est survenue. Veuillez réessayer."}
              </p>
              {errorMsg && <p className="text-xs text-muted-foreground">{errorMsg}</p>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Unsubscribe;
