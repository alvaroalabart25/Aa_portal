import { Link } from 'react-router-dom';

/**
 * Privacidad y términos, en páginas PÚBLICAS (sin iniciar sesión).
 *
 * Existen porque Enable Banking las exige para una aplicación de producción, y
 * tiene sentido: son las que el banco puede enseñar a quien va a autorizar la
 * lectura de sus cuentas. Aunque hoy ese alguien sea siempre él, la pantalla
 * del banco las enlaza y tienen que abrir.
 *
 * Lo que dicen es lo que el portal hace de verdad, ni más ni menos. Si algún
 * día cambia lo que se lee o dónde se guarda, esto se cambia con ello.
 */

function Marco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="legal">
      <header className="legal-top">
        <span className="legal-logo">Aa</span>
        <Link to="/login" className="btn ghost sm">
          Entrar
        </Link>
      </header>
      <h1>{titulo}</h1>
      {children}
      <footer className="legal-pie">
        <Link to="/privacidad">Privacidad</Link>
        <span>·</span>
        <Link to="/terminos">Términos de uso</Link>
      </footer>
    </div>
  );
}

export function Privacidad() {
  return (
    <Marco titulo="Privacidad">
      <p className="legal-fecha">Última actualización: 20 de agosto de 2026</p>

      <h2>Qué es este portal</h2>
      <p>
        Aa Portal es una herramienta de organización personal de uso privado, sin registro abierto: solo se entra con
        una invitación. No es un producto comercial y no se ofrece a terceros.
      </p>

      <h2>Qué datos se guardan</h2>
      <p>
        Lo que cada persona escribe en su cuenta: tareas, proyectos, notas, metas, apuntes de salud y entrenamiento, y
        facturación. Cada cuenta ve únicamente lo suyo.
      </p>

      <h2>Datos bancarios</h2>
      <p>
        Si conectas una cuenta bancaria, el portal accede <b>solo en modo lectura</b>, a través de un proveedor de
        banca abierta autorizado (Enable Banking) y con tu consentimiento explícito, dado en la web de tu propio
        banco. Concretamente:
      </p>
      <ul>
        <li>Se leen tus cuentas, sus saldos y sus movimientos.</li>
        <li>
          <b>Nunca se ven ni se guardan tus credenciales bancarias.</b> La identificación ocurre en tu banco; el
          portal solo recibe un identificador de sesión con caducidad.
        </li>
        <li>
          <b>No se puede mover dinero.</b> El portal no solicita permisos de pago; solo de información de cuentas.
        </li>
        <li>Del IBAN se conservan únicamente los cuatro últimos dígitos.</li>
        <li>El consentimiento caduca (unos 180 días) y puede revocarse en cualquier momento desde el portal o desde tu banco.</li>
      </ul>

      <h2>Dónde se guardan</h2>
      <p>
        En una base de datos propia alojada en la Unión Europea o en Estados Unidos según el proveedor, cifrada en
        tránsito. No se venden, no se comparten con terceros y no se usan para publicidad ni para entrenar modelos.
      </p>

      <h2>Quién puede verlos</h2>
      <p>
        Solo el titular de cada cuenta. La administración del portal puede ver <b>cuándo</b> y <b>cuánto</b> se usa
        una cuenta (última visita, número de entradas y cuántas filas ocupa), pero <b>no su contenido</b>: la API no
        lo devuelve ni para el administrador.
      </p>

      <h2>Tus derechos</h2>
      <p>
        Puedes pedir en cualquier momento una copia de tus datos o su borrado, y desconectar tu banco sin perder lo ya
        leído. Escribe a <a href="mailto:alvaritoalabart@gmail.com">alvaritoalabart@gmail.com</a>.
      </p>
    </Marco>
  );
}

export function Terminos() {
  return (
    <Marco titulo="Términos de uso">
      <p className="legal-fecha">Última actualización: 20 de agosto de 2026</p>

      <h2>Uso del portal</h2>
      <p>
        Aa Portal es una herramienta personal de uso privado. El acceso es por invitación y personal: no se comparten
        cuentas ni credenciales. Quien recibe una invitación es responsable de lo que hace con su cuenta.
      </p>

      <h2>Conexión bancaria</h2>
      <p>
        La conexión con entidades bancarias se realiza mediante un proveedor de banca abierta autorizado y se limita a
        la <b>lectura</b> de cuentas, saldos y movimientos, con el consentimiento del titular. El portal no ejecuta
        pagos ni transferencias, y no puede hacerlo. La conexión se limita a las cuentas del propio titular.
      </p>

      <h2>Sin garantías</h2>
      <p>
        El portal se ofrece «tal cual», sin garantía de disponibilidad ni de exactitud. La información que muestra es
        orientativa: para cualquier decisión, manda lo que diga tu banco o tu asesoría. No presta asesoramiento
        financiero, fiscal, médico ni deportivo.
      </p>

      <h2>Fin del servicio</h2>
      <p>
        Cualquier cuenta puede pedir su baja y el borrado de sus datos cuando quiera. El portal puede dejar de estar
        disponible sin previo aviso, por ser un proyecto personal.
      </p>

      <h2>Contacto</h2>
      <p>
        <a href="mailto:alvaritoalabart@gmail.com">alvaritoalabart@gmail.com</a>
      </p>
    </Marco>
  );
}
