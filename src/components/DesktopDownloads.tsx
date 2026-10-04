import { Download } from "lucide-react";
import { DESKTOP_PLATFORMS, detectOS, downloadUrl } from "../lib/downloads";
import { buttonClass } from "./ui";

/** Home-page section: the visitor's own build up front, every build listed beside it. */
export function DesktopDownloads() {
  const os = detectOS();
  const platform = os && DESKTOP_PLATFORMS[os];

  return (
    <section
      id="baixar"
      aria-labelledby="baixar-titulo"
      className="mx-auto flex max-w-[1240px] scroll-mt-6 flex-col gap-5 px-5 pb-20 sm:px-8"
    >
      <h2 id="baixar-titulo" className="font-display text-xl font-bold">
        App para computador
      </h2>
      <div className="grid gap-8 rounded-xl border border-line bg-panel p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12">
        <div className="flex flex-col gap-6">
          <p className="max-w-[52ch] text-soft">
            As mesmas salas numa janela própria: escolha telas e janelas pela miniatura e mande o som do
            computador junto com a tela.
          </p>
          {platform ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-3">
                {platform.builds
                  .filter((build) => build.cta)
                  .map((build) => (
                    <a key={build.file} href={downloadUrl(build.file)} className={buttonClass({ variant: "primary" })}>
                      <Download className="size-5" strokeWidth={2.25} />
                      {build.cta}
                    </a>
                  ))}
              </div>
              <p className="max-w-[60ch] text-sm text-soft">{platform.hint}</p>
            </div>
          ) : (
            <p className="text-sm text-soft">Disponível para Windows, macOS e Linux.</p>
          )}
        </div>

        <dl className="flex flex-col">
          {Object.entries(DESKTOP_PLATFORMS).map(([key, { name, builds }]) => (
            <div
              key={key}
              className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-x-4 border-t border-line py-4 first:border-t-0 first:pt-0 last:pb-0"
            >
              <dt className="text-sm font-semibold text-soft">{name}</dt>
              <dd className="flex flex-wrap gap-2">
                {builds.map((build) => (
                  <a
                    key={build.file}
                    href={downloadUrl(build.file)}
                    aria-label={`${name}: ${build.label}`}
                    className="type-link-sm flex h-10 items-center rounded-md border border-line bg-surface px-3.5 text-ink transition hover:bg-surface-hi"
                  >
                    {build.label}
                  </a>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
