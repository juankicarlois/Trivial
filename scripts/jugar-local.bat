@echo off
rem Lanzador del Trivial para jugar en local (tu solo o con gente de tu red, sin
rem internet). Arranca el servidor en su ventana y abre el juego en el navegador.
rem Para jugar con alguien de tu misma red, que abra http://TU-IP:3000.
rem La ruta es relativa a este .bat, asi que el lanzador es portable.

set "ROOT=%~dp0.."

start "Servidor Trivial" /D "%ROOT%" cmd /k npm run dev

rem Un margen para que el servidor este listo antes de abrir el navegador.
timeout /t 5 /nobreak >nul

start "" http://localhost:3000

exit
