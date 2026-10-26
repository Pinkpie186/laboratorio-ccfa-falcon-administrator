# Docker Desktop + WSL 2 sem esgotar o disco

Diagnóstico em 17/08/2026: WSL ausente, aproximadamente 8 GB de RAM e apenas 18 GB livres no `C:`. Não é prudente instalar antes de liberar espaço. A meta recomendada para esta máquina é **35 GB livres no mínimo; 45 GB é mais confortável**. Essa margem é uma recomendação operacional para manter Windows Update, paginação, WSL, imagens e o banco funcionando — não um requisito oficial do Docker.

## 1. Liberar espaço com segurança

Use **Configurações → Sistema → Armazenamento → Arquivos temporários** e revise cada categoria. Não marque Downloads sem conferir. Remova aplicativos que não usa e mova vídeos/ISOs/instaladores para outro disco. Não apague manualmente `WinSxS`, `ProgramData`, arquivos VHDX ou pastas do Docker/WSL.

Confira novamente:

```powershell
Get-PSDrive C | Select-Object Name,@{N='LivreGB';E={[math]::Round($_.Free/1GB,1)}}
```

## 2. Simular e instalar

Abra PowerShell normal para o teste:

```powershell
Set-Location '<caminho-local>\falcon-admin-platform'
powershell -ExecutionPolicy Bypass -File .\scripts\windows\install-docker-wsl-safe.ps1
```

Quando houver pelo menos 35 GB livres, abra **PowerShell como Administrador**:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\install-docker-wsl-safe.ps1 -Apply
```

Na primeira passagem, o Windows pode pedir reinicialização após habilitar o WSL. Reinicie e execute o mesmo comando novamente. O script:

- interrompe se houver menos de 35 GB livres ou menos de 8 GB de RAM;
- instala WSL sem uma distribuição Ubuntu extra;
- limita a VM WSL a 3 GB de RAM, 2 processadores e 1 GB de swap;
- limita novos VHDs WSL a 30 GB e habilita VHD esparso;
- baixa o instalador oficial, verifica a assinatura digital e instala por usuário;
- usa WSL 2, Linux containers e desabilita integração com Windows containers.

Se futuramente existir um SSD `D:` com espaço, use:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\install-docker-wsl-safe.ps1 -Apply -DockerDataRoot 'D:\DockerWSL'
```

## 3. Ajustes depois de abrir o Docker Desktop

Mantenha **Resource Saver** habilitado. Em **Settings → Docker Engine**, preserve as outras propriedades existentes e acrescente:

```json
{
  "log-driver": "local",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

Depois, em **Settings → Resources → WSL Integration**, habilite somente a distribuição realmente usada. Não habilite Kubernetes: nesta máquina ele consumiria memória e disco desnecessários.

## 4. Uso seguro do projeto

```powershell
Copy-Item .env.example .env
docker compose up --build -d
docker system df
```

Para parar sem apagar PostgreSQL e documentos:

```powershell
docker compose down
```

Nunca use `docker compose down -v` neste projeto: `-v` remove os volumes com o banco e os arquivos privados.

## 5. Manutenção de disco

Verifique semanalmente:

```powershell
docker system df
docker buildx du
```

Para limpar apenas cache de build antigo, após revisar o uso:

```powershell
docker buildx prune --filter 'until=168h' --max-used-space 2gb
```

`docker system prune` remove recursos não usados; leia a prévia e confirme conscientemente. Evite `docker system prune -a --volumes`, pois pode remover imagens necessárias e volumes anônimos. Antes de qualquer limpeza de volumes, faça backup do PostgreSQL conforme o README.

Após apagar muitos dados, execute `wsl --shutdown`. VHD esparso ajuda novos discos a devolver espaço; não compacte ou edite um `.vhdx` enquanto WSL/Docker estiver rodando.

Fontes oficiais: [instalação do WSL](https://learn.microsoft.com/windows/wsl/install), [instalação do Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/), [configuração do WSL](https://learn.microsoft.com/windows/wsl/wsl-config), [configurações do Docker Desktop](https://docs.docker.com/desktop/settings-and-maintenance/settings/) e [limitação de logs](https://docs.docker.com/engine/logging/configure/).
