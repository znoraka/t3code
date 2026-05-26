import { useCallback, useState } from "react";
import { useT3ChatAuthStore } from "../../t3chatAuthStore";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { ExternalLinkIcon, SettingsIcon } from "lucide-react";

const BOOKMARKLET_CODE = `javascript:void(function(){var c=document.cookie.match(/convex-session-id=([^;]+)/);var convex=c?c[1]:"";var wos=prompt("Copy wos-session from DevTools > Application > Cookies > t3.chat\\n\\nPaste it here:");if(wos){window.open("${window.location.origin}/t3chat?wos="+encodeURIComponent(wos)+"&convex="+encodeURIComponent(convex),"_self")}})()`;

export function T3ChatAuthDialog() {
  const { wosSession, convexSessionId, setCredentials, clearCredentials } = useT3ChatAuthStore();
  const isConfigured = !!wosSession && !!convexSessionId;

  const [wos, setWos] = useState(wosSession ?? "");
  const [convex, setConvex] = useState(convexSessionId ?? "");

  const handleSave = useCallback(() => {
    if (wos.trim() && convex.trim()) {
      setCredentials(wos.trim(), convex.trim());
    }
  }, [wos, convex, setCredentials]);

  const handleClear = useCallback(() => {
    clearCredentials();
    setWos("");
    setConvex("");
  }, [clearCredentials]);

  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <span
              className={`size-1.5 rounded-full ${isConfigured ? "bg-emerald-500" : "bg-red-500"}`}
            />
            <SettingsIcon className="size-3" />
          </button>
        }
      />
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>T3 Chat Connection</DialogTitle>
          <DialogDescription>
            Connect your T3 Chat account to use it inside T3 Code.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-4">
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="mb-2 text-xs font-medium text-foreground">Quick connect (recommended)</p>
            <ol className="mb-3 flex flex-col gap-1 text-[11px] text-muted-foreground">
              <li>
                1. Drag this to your bookmark bar:{" "}
                <a
                  href={BOOKMARKLET_CODE}
                  onClick={(e) => e.preventDefault()}
                  className="inline-block rounded bg-accent px-1.5 py-0.5 font-medium text-accent-foreground"
                >
                  Connect T3 Chat
                </a>
              </li>
              <li>2. Go to t3.chat and make sure you're logged in</li>
              <li>3. Click the bookmarklet — it auto-fills everything</li>
            </ol>
            <a
              href="https://t3.chat"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Open t3.chat
              <ExternalLinkIcon className="size-3" />
            </a>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Or paste manually</p>
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">wos-session cookie</span>
                <Input
                  value={wos}
                  onChange={(e) => setWos(e.target.value)}
                  placeholder="eyJhbGciOi..."
                  size="sm"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">convex-session-id cookie</span>
                <Input
                  value={convex}
                  onChange={(e) => setConvex(e.target.value)}
                  placeholder="abc123-..."
                  size="sm"
                />
              </label>
              <span className="text-[10px] text-muted-foreground">
                Both found in DevTools → Application → Cookies → t3.chat
              </span>
            </div>
          </div>
        </div>
        <DialogFooter>
          {isConfigured && (
            <Button variant="destructive-outline" size="sm" onClick={handleClear}>
              Disconnect
            </Button>
          )}
          <DialogClose
            render={
              <Button size="sm" onClick={handleSave} disabled={!wos.trim() || !convex.trim()}>
                Save
              </Button>
            }
          />
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
