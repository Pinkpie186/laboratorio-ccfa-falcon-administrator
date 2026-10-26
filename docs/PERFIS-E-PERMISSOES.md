# Perfis e permissões

As permissões abaixo são validadas no servidor. Ocultar um botão na interface não concede nem remove acesso.

| Ação | Usuário comum (`analyst`) | Gerente (`manager`) | Revisor Demo (`admin_reviewer`) |
|---|---:|---:|---:|
| Ver e editar o próprio perfil | Sim | Sim | Sim |
| Ver os próprios estudos, provas e evidências | Sim | Sim | Sim |
| Ver a biblioteca da equipe | Sim | Sim | Sim |
| Importar e sincronizar documentos | Não | Sim | Sim |
| Ver desempenho individual da equipe | Não | Sim | Sim |
| Aprovar ou reprovar provas | Não | **Sim** | Não |
| Ver auditoria e relatórios de gestão | Não | Sim | Sim |
| Revisar e publicar questões | Não | Não | Sim |
| Cadastrar módulos manualmente | Não | Não | **Sim** |

Uma reprovação de prova exige motivo. Toda decisão registra a identidade do gerente, data, hora e justificativa na trilha de auditoria append-only.

Dados de desempenho são sempre consultados com uma certificação explícita. Tentativas, domínios, gráficos e relatórios de uma certificação não são agregados em outra.
