@echo off
rem Lanzador del Trivial para jugar por internet: arranca el servidor y el tunel,
rem cada uno en su ventana. La ventana del tunel muestra (y copia al portapapeles)
rem la URL para compartir. Cierra cualquiera de las ventanas para terminar.
rem La ruta es relativa a este .bat, asi que el lanzador es portable.

set "ROOT=%~dp0.."

start "Servidor Trivial" /D "%ROOT%" cmd /k npm run dev

rem Un margen para que el servidor arranque antes que el tunel.
timeout /t 4 /nobreak >nul

start "Tunel Trivial - URL para compartir" /D "%ROOT%" cmd /k npm run tunnel

exit
