# Claudia v3.3 - Sistema Autonomous

## endpoints API
- /api/clientes - Lista clientes
- /api/proyectos - Lista proyectos
- /api/tareas - Lista tareas
- /api/stats - Ingresos totales
- /api/usuarios - Usuarios autorizados
- /api/memoria - Memoria maastra
- /api/boveda - Conocimiento guardado
- /api/buscar?q=... - Buscar en web
- /api/think?p=[prompt] - Pensar/ReAct
- /api/orquesta?t=[tarea] - Plan orquestacion

## Comandos Telegram
- /start - Iniciar
- /parcelas - Inventario
- /autos - Vehiculos
- /promarket - Agencia
- /bioquantum - Fitness
- /proyectos - Proyectos
- /genera - Landing simple
- /nuevo_sistema - Landing completa
- /plantillas - Ver plantillas
- /usuarios - Ver usuarios (solo Roberto)
- /invitar - Agregar usuario
- /inventario - Actualizar inventario
- /equipo - Progreso equipo
- /buscar - Investigar web
- /memoria - Ver memoria
- /boveda - Ver conocimiento
- /orquesta - Ver plan

## Configuracion (env)
- TELEGRAM_BOT_TOKEN
- OPENROUTER_KEYS (JSON array)
- FIREBASE_CONFIG (JSON service account)
- GITHUB_TOKEN
- VERCEL_TOKEN
- SHEETS_KEY
- TAVILY_KEY