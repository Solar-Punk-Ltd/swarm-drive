+----------------------+      +---------------------+      +------------------------+
|  User Workstation    |      |   Swarm-Sync CLI    |      |    Config & State      |
|  • Local Folder      |─────▶|   • init / sync /   |─────▶|  • .swarm-sync.json     |
|  • Git Repo          |      |     watch           |      |  • .swarm-state.json    |
+----------------------+      +---------------------+      +------------------------+
                                                              │
                                                              ▼
                                                    +------------------------+
                                                    |  FileManager Library   |
                                                    | (@solarpunkltd/file-   |
                                                    |   manager-lib)         |
                                                    +------------------------+
                                                              │
                                                              ▼
                                                    +------------------------+
                                                    |   Bee SDK              |
                                                    | (@ethersphere/bee-js)  |
                                                    +------------------------+
                                                              │
                                                              ▼
                                                    +------------------------+
                                                    |  Bee Node (local)      |
                                                    |  • HTTP API @ :1633    |
                                                    +------------------------+
                                                              │
                                                              ▼
                                                    +------------------------+
                                                    |    Swarm Network       |
                                                    +------------------------+
