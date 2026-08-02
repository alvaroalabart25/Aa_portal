/**
 * Aviso de apartado en revisión. No bloquea nada: lo que hay dentro sigue
 * funcionando, pero deja claro que su forma va a cambiar, para que no se
 * confunda «está a medias» con «así se queda».
 */
export default function EnDesarrollo({ children }: { children: React.ReactNode }) {
  return (
    <div className="wip">
      <span className="wip-tag">En desarrollo</span>
      <p className="wip-text">{children}</p>
    </div>
  );
}
