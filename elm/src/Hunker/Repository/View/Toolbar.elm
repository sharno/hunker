module Hunker.Repository.View.Toolbar exposing (Config, view)

import Html exposing (Html, button, div, span, strong, text)
import Html.Attributes exposing (attribute, class, type_)
import Html.Events exposing (onClick)
import Hunker.Route exposing (RepositoryTab(..))


type alias Config msg =
    { repository : String
    , activeTab : RepositoryTab
    , selectedTab : RepositoryTab -> msg
    }


view : Config msg -> List (Html msg)
view config =
    [ div [ class "repository-identity" ]
        [ span [] [ text "Local repository" ]
        , strong [] [ text config.repository ]
        ]
    , div [ class "segmented repository-view-tabs", attribute "role" "group", attribute "aria-label" "Repository view" ]
        [ tabButton config "Files" RepositoryFiles
        , tabButton config "Pull requests" RepositoryPulls
        , tabButton config "Commits" RepositoryCommits
        ]
    ]


tabButton : Config msg -> String -> RepositoryTab -> Html msg
tabButton config label tab =
    button
        [ type_ "button"
        , class
            ("segmented-button"
                ++ (if tab == config.activeTab then
                        " is-active"

                    else
                        ""
                   )
            )
        , onClick (config.selectedTab tab)
        ]
        [ text label ]
